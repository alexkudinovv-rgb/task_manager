// CLI: npm run db:migrate -w apps/server
import { createDb, migrationsFolder, runMigrations } from './client'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Copy apps/server/.env.example to apps/server/.env or export it.')
  process.exit(1)
}

const { db, close } = createDb(url, { max: 1 })
try {
  await runMigrations(db)
  console.log(`Migrations applied from ${migrationsFolder}`)
} catch (error) {
  console.error('Migration failed:', error)
  process.exitCode = 1
} finally {
  await close()
}
