import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { createDb, runMigrations, type DbHandle } from '../db/client'
import { seedReferenceData } from '../db/reference-data'

/** Local Postgres from docker-compose; integration tests skip when it is not configured. */
export const TEST_DATABASE_URL = process.env.DATABASE_URL

export interface TestDb extends DbHandle {
  drop: () => Promise<void>
}

/** A throwaway database with migrations and reference data applied. Call drop() in afterAll. */
export async function createTestDb(): Promise<TestDb> {
  if (!TEST_DATABASE_URL) throw new Error('DATABASE_URL is not set')
  const name = `tasks_test_${randomBytes(6).toString('hex')}`
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name}`)
  const url = new URL(TEST_DATABASE_URL)
  url.pathname = `/${name}`
  const handle = createDb(url.toString(), { max: 4 })
  await runMigrations(handle.db)
  await seedReferenceData(handle.db)
  return {
    ...handle,
    drop: async () => {
      // pool.end() resolves before sockets finish closing; DROP ... WITH (FORCE) may then kill a
      // closing client, which the pool reports as an error. Expected during teardown.
      handle.pool.on('error', () => {})
      await handle.close()
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await admin.end()
    },
  }
}
