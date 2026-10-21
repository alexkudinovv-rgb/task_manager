import { defineConfig } from 'drizzle-kit'

// `generate` works offline; `migrate`/`studio` need DATABASE_URL.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://tasks:dev@127.0.0.1:5432/tasks',
  },
  strict: true,
  verbose: true,
})
