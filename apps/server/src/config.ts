import { z } from 'zod'

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url().optional(),
  /** Where people open the app; invite links are built from it. */
  PUBLIC_URL: z.url().default('http://localhost:5173'),
  /** base64 of 32 random bytes; encrypts TOTP secrets at rest. Required once users exist. */
  TOTP_ENCRYPTION_KEY: z.string().min(1).optional(),
  /** Absolute path to the built web app (apps/web/dist); served at / when set. */
  WEB_DIST: z.string().min(1).optional(),
  /** Temporary shared key for the MCP spike; per-user keys replace it in stage 7. */
  MCP_DEV_KEY: z.string().min(16).optional(),
})

export type Config = z.infer<typeof ConfigSchema>

/** Fails fast on a bad environment instead of starting half-configured. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}
