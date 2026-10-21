// CLI: npm run db:seed -w apps/server. Safe to run repeatedly; never creates users.
import { createDb } from './client'
import { seedReferenceData } from './reference-data'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Copy apps/server/.env.example to apps/server/.env or export it.')
  process.exit(1)
}

const { db, close } = createDb(url, { max: 1 })
try {
  const inserted = await seedReferenceData(db)
  console.log('Seed done, rows inserted:', inserted)
} catch (error) {
  console.error('Seed failed:', error)
  process.exitCode = 1
} finally {
  await close()
}
