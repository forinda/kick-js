import { z } from 'zod'
import { Container } from '../core/container'
import type { EnvKey } from '../core/decorators'

/**
 * Lazily load `dotenv/config` if it is installed in the consumer app.
 * `dotenv` is an **optional peer dependency** of `@forinda/kickjs` —
 * apps that want `.env` file support install it themselves (the CLI
 * generators add it to every scaffolded `package.json`). Apps that
 * inject env via the shell, Docker, or a secret manager can skip it
 * entirely and `process.env` is read as-is.
 *
 * This module-load side effect runs exactly once.
 */
function tryLoadDotenv(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv/config')
  } catch {
    // dotenv not installed — fall through, env vars must come from
    // the environment directly. This is a valid deployment style.
  }
}
tryLoadDotenv()

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
 * Define a custom env schema. The base schema (`PORT`, `NODE_ENV`,
 * `LOG_LEVEL`) is always merged in, so users never need to remember to
 * extend it themselves — both styles below produce the same result and
 * both surface the base keys in `KickEnv`.
 *
 * Returns a Zod schema that validates `process.env`.
 *
 * @example
 * ```ts
 * // Style A — return a fresh object; base fields are merged automatically
 * export default defineEnv(() =>
 *   z.object({
 *     DATABASE_URL: z.string().url(),
 *     JWT_SECRET: z.string().min(32),
 *   })
 * )
 *
 * // Style B — explicitly extend `base` (still works, identical result)
 * export default defineEnv((base) =>
 *   base.extend({
 *     DATABASE_URL: z.string().url(),
 *   })
 * )
 * ```
 *
 * User-defined keys override base keys when they collide, so a project
 * can re-type `PORT` or tighten `NODE_ENV` without losing the rest of
 * the base shape.
 */
export function defineEnv<T extends z.ZodRawShape>(
  extend: (base: typeof baseEnvSchema) => z.ZodObject<T>,
): z.ZodObject<typeof baseEnvSchema.shape & T> {
  const userSchema = extend(baseEnvSchema)
  // Always merge the base in. `extend` lets the user's shape override
  // any colliding base keys, which preserves the escape hatch for
  // projects that want to re-type `PORT` etc.
  return baseEnvSchema.extend(userSchema.shape) as z.ZodObject<typeof baseEnvSchema.shape & T>
}

/**
 * Parse and validate process.env against a Zod schema. Caches result per schema.
 *
 * **No-arg behaviour is sticky.** The first time `loadEnv(schema)` is called
 * with an extended schema, the cache holds that schema. Subsequent
 * `loadEnv()` calls (no arg) will reuse the cached extended schema rather
 * than falling back to `baseEnvSchema` and clobbering the env resolver.
 *
 * This matters because `ConfigService` (and the bare `Container._envResolver`)
 * call `loadEnv()` without an argument inside their constructors. Without
 * stickiness, instantiating `ConfigService` after a `loadEnv(extendedSchema)`
 * call would silently downgrade the env to the base shape.
 *
 * To force a re-parse with a different schema, pass the new schema explicitly.
 * To start fresh, call `resetEnvCache()` or `reloadEnv()`.
 *
 * **Typing:**
 * - With an explicit schema → returns `z.infer<typeof schema>`.
 * - With no schema and `KickEnv` populated by typegen → returns
 *   `KickEnv` (the project-wide typed env shape).
 * - With no schema and `KickEnv` empty → returns the base `Env`.
 */
export function loadEnv<T extends z.ZodObject<any>>(schema: T): z.infer<T>
export function loadEnv(): [EnvKey] extends [never] ? Env : KickEnv
export function loadEnv<T extends z.ZodObject<any>>(schema?: T): any {
  // Sticky: when called with no arg, prefer the most recently cached
  // schema over re-parsing with the base schema.
  const s = schema ?? cachedSchema ?? baseEnvSchema
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
 * Three forms:
 * - **No-arg, KickEnv populated** (`kick typegen` has run) → key is
 *   constrained to known `KickEnv` keys; return type inferred from
 *   the schema.
 * - **With explicit schema** → key constrained to that schema's keys;
 *   return type is `z.infer<typeof schema>[K]`.
 * - **No-arg, KickEnv empty** → loose `string` key, `any` return.
 *
 * @example
 * ```ts
 * // After `kick typegen` (KickEnv populated):
 * const port = getEnv('PORT')              // typed as number
 * const url = getEnv('DATABASE_URL')       // typed as string
 *
 * // With an inline schema (legacy / one-off):
 * const dbUrl = getEnv('DATABASE_URL', envSchema)
 * ```
 */
export function getEnv<K extends EnvKey>(key: K): KickEnv[K]
export function getEnv<T extends z.ZodObject<any>, K extends string & keyof z.infer<T>>(
  key: K,
  schema: T,
): z.infer<T>[K]
export function getEnv(key: string, schema?: z.ZodObject<any>): any {
  const env = schema ? loadEnv(schema) : (loadEnv() as Record<string, any>)
  return env[key]
}

/**
 * Reload env from process.env (re-reads dotenv if installed, clears cache).
 * Called during HMR rebuild to pick up .env file changes.
 */
export function reloadEnv(): void {
  // Re-read .env file into process.env if dotenv is installed.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config({ override: true })
  } catch {
    // dotenv not installed — nothing to reload, env comes from the
    // environment directly.
  }

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
