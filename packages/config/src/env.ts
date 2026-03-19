import { z } from 'zod'
import 'dotenv/config'

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

/** Cached env config to avoid re-parsing */
let cachedEnv: any = null

/**
 * Define a custom env schema by extending the base.
 * Returns a loader function that validates process.env.
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
 * ```
 */
export function defineEnv<T extends z.ZodRawShape>(
  extend: (base: typeof baseEnvSchema) => z.ZodObject<any>,
): z.ZodObject<any> {
  return extend(baseEnvSchema)
}

/** Parse and validate process.env against a Zod schema. Caches result. */
export function loadEnv<T extends z.ZodObject<any>>(schema?: T): z.infer<T> {
  if (cachedEnv) return cachedEnv
  const s = schema || baseEnvSchema
  cachedEnv = s.parse(process.env)
  return cachedEnv
}

/** Get a single typed environment variable value */
export function getEnv<K extends string>(key: K): any {
  const env = loadEnv()
  return (env as any)[key]
}

/** Reset cached env (useful for testing) */
export function resetEnvCache(): void {
  cachedEnv = null
}

export type Env = z.infer<typeof baseEnvSchema>
