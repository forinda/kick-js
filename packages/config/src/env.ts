import { z } from 'zod'
import 'dotenv/config'
import { Container } from '@forinda/kickjs-core'

/**
 * Base environment schema with common server variables.
 * Users extend this with their own application-specific vars.
 */
export const baseEnvSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
})

/** Cached env config to avoid re-parsing — keyed by schema reference */
let cachedEnv: any = null
let cachedSchema: any = null

/**
 * Define a custom env schema by extending the base.
 * Returns a Zod schema that validates process.env.
 *
 * @example
 * ```ts
 * const envSchema = defineEnv((base) =>
 *   base.extend({
 *     DATABASE_URL: z.string().url(),
 *     JWT_SECRET: z.string().min(32),
 *     REDIS_URL: z.string().url().optional(),
 *   })
 * )
 *
 * const env = loadEnv(envSchema)
 * env.DATABASE_URL // string — fully typed, autocompletes
 * ```
 */
export function defineEnv<T extends z.ZodRawShape>(
  extend: (base: typeof baseEnvSchema) => z.ZodObject<T>,
): z.ZodObject<T> {
  return extend(baseEnvSchema)
}

/** Parse and validate process.env against a Zod schema. Caches result per schema. */
export function loadEnv<T extends z.ZodObject<any>>(schema?: T): z.infer<T> {
  const s = schema || baseEnvSchema
  // Re-parse if schema changed or no cache yet
  if (cachedEnv && cachedSchema === s) return cachedEnv
  cachedSchema = s
  cachedEnv = s.parse(process.env)

  // Register env resolver so @Value() reads validated values
  Container._envResolver = (key: string) => cachedEnv?.[key]

  return cachedEnv
}

/**
 * Get a single typed environment variable value.
 *
 * @example
 * ```ts
 * // Without schema — returns `any`
 * const port = getEnv('PORT')
 *
 * // With schema — fully typed key + return value
 * const dbUrl = getEnv('DATABASE_URL', envSchema)
 * ```
 */
export function getEnv<T extends z.ZodObject<any>, K extends string & keyof z.infer<T>>(
  key: K,
  schema?: T,
): z.infer<T>[K] {
  const env = loadEnv(schema)
  return env[key]
}

/**
 * Reload env from process.env (re-reads dotenv, clears cache).
 * Called during HMR rebuild to pick up .env file changes.
 */
export function reloadEnv(): void {
  // Re-read .env file into process.env
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ override: true })

  // Clear the parse cache so next loadEnv() re-validates
  cachedEnv = null
  cachedSchema = null
}

/** Reset cached env (useful for testing) */
export function resetEnvCache(): void {
  cachedEnv = null
  cachedSchema = null
}

export type Env = z.infer<typeof baseEnvSchema>
