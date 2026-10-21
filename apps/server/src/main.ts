import { buildApp } from './app'
import { loadConfig } from './config'
import { createDb } from './db/client'

const config = loadConfig()
const database = config.DATABASE_URL ? createDb(config.DATABASE_URL) : undefined
const app = buildApp(config, { db: database?.db })
if (database) app.addHook('onClose', database.close)

try {
  await app.listen({ host: config.HOST, port: config.PORT })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
