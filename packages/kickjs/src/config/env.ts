import type { z } from 'zod'
import { detectSchema, type InferSchemaOutput } from '@forinda/kickjs-schema'
import { Container } from '../core/container'
import type { EnvKey } from '../core/decorators'

/**
 * Lazy `zod` accessor. `zod` is an **optional** peer of
 * `@forinda/kickjs` — only the Zod-based env helpers (`baseEnvSchema`,
 * `defineEnv`, `loadEnv`) need it. Apps that validate env via Valibot /
 * Yup / Standard Schema go through `loadEnvFromSchema` (which only
 * touches the validator-agnostic `detectSchema`) and never load zod.
 *
 * Importing `zod` at module top-level made it a *hard* dependency of
 * the whole framework: `import { anything } from '@forinda/kickjs'`
 * eagerly evaluated this module, so a non-Zod app with no `zod`
 * installed crashed at module load / build time ("Cannot find module
 * 'zod'"). Deferring the require to first use keeps the import out of
 * the eager graph.
 */
let _zod: typeof import('zod') | undefined
function getZod(): typeof import('zod') {
  if (_zod) return _zod
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _zod = require('zod') as typeof import('zod')
  } catch {
    throw new Error(
      "@forinda/kickjs: the 'zod' peer dependency is required for " +
        'baseEnvSchema / defineEnv / loadEnv but is not installed. ' +
        'Install it (`pnpm add zod`), or define your env with a non-Zod ' +
        'schema and call loadEnvFromSchema() instead — @forinda/kickjs-schema ' +
        'supports Valibot, Yup, and any Standard Schema validator without zod.',
    )
  }
  return _zod
}

/**
 * Lazily load `.env` via dotenv if it is installed in the consumer app.
 * `dotenv` is an **optional peer dependency** of `@forinda/kickjs` —
 * apps that want `.env` file support install it themselves (the CLI
 * generators add it to every scaffolded `package.json`). Apps that
 * inject env via the shell, Docker, or a secret manager can skip it
 * entirely and `process.env` is read as-is.
 *
 * We call `dotenv.config()` directly rather than `require('dotenv/config')`
 * so that a re-evaluation of this module (e.g. Vite SSR full-reload after
 * editing `.env`) can re-read the file. `dotenv/config` is a side-effect
 * shim that CJS caches aggressively, so the second `require` is a no-op
 * and new keys never reach `process.env` — the root cause of the
 * "DATABASE_URL undefined until restart" bug on Windows dev.
 */
function tryLoadDotenv(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dotenv = require('dotenv')
    // `quiet: true` suppresses dotenv 17's tip banner that goes to stdout.
    // Required for CLI tools whose stdout is parsed by callers (`kick explain
    // --json`, etc) — the banner would otherwise corrupt the JSON output.
    dotenv.config({ override: false, quiet: true })
  } catch {
    // dotenv not installed — fall through, env vars must come from
    // the environment directly. This is a valid deployment style.
  }
}
tryLoadDotenv()

/**
 * Build the base env schema. Memoized so repeated calls reuse one
 * schema instance (matters for the `cachedSchema === s` identity check
 * in {@link loadEnv}). Loads zod lazily via {@link getZod}.
 */
// Build the concrete base schema. This function is the single source of
// the *type* of `baseEnvSchema` (via `ReturnType<typeof buildBaseEnvSchema>`)
// AND its runtime value (via `getBaseEnvSchema`). It is NEVER called at
// module load — only lazily through `getBaseEnvSchema()` — so referencing
// its return type stays compile-time-only and pulls no eager zod import.
// Spelling the type this way (rather than `z.ZodObject<any>`) preserves the
// precise PORT/NODE_ENV/LOG_LEVEL shape, which `defineEnv` composition and
// the `kick typegen` `KickEnv` inference depend on.
function buildBaseEnvSchema() {
  const z = getZod()
  return z.object({
    // Server
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.string().default('info'),
  })
}

/** Precise type of the base env schema — no runtime value, no eager zod. */
export type BaseEnvSchema = ReturnType<typeof buildBaseEnvSchema>

/**
 * Memoized base schema. Reuses one instance so the `cachedSchema === s`
 * identity check in {@link loadEnv} holds. Loads zod lazily.
 */
let _baseEnvSchema: BaseEnvSchema | undefined
export function getBaseEnvSchema(): BaseEnvSchema {
  if (!_baseEnvSchema) _baseEnvSchema = buildBaseEnvSchema()
  return _baseEnvSchema
}

/**
 * Base environment schema with common server variables.
 * Users extend this with their own application-specific vars.
 *
 * Back-compat lazy view over {@link getBaseEnvSchema}: constructing the
 * Proxy does NOT load zod — zod is only required the moment a property
 * (`.extend`, `.parse`, `.shape`, …) is actually accessed. This keeps
 * `import { baseEnvSchema } from '@forinda/kickjs'` zero-cost for apps
 * that don't use the Zod env path, while keeping the precise schema type.
 */
export const baseEnvSchema: BaseEnvSchema = new Proxy({} as BaseEnvSchema, {
  get(_t, prop) {
    const real = getBaseEnvSchema() as unknown as Record<string | symbol, unknown>
    const value = real[prop]
    // Bind methods to the real schema so zod's internal `this` works.
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value
  },
  has(_t, prop) {
    return prop in (getBaseEnvSchema() as object)
  },
}) as BaseEnvSchema

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
  const base = getBaseEnvSchema()
  const userSchema = extend(base as typeof baseEnvSchema)
  // Always merge the base in. `extend` lets the user's shape override
  // any colliding base keys, which preserves the escape hatch for
  // projects that want to re-type `PORT` etc.
  return base.extend(userSchema.shape) as z.ZodObject<typeof baseEnvSchema.shape & T>
}

/**
 * Parse and validate `process.env` against a Zod schema. Caches result per schema.
 *
 * **No-arg behaviour is sticky.** The first time `loadEnv(schema)` is called
 * with an extended schema, the cache holds that schema. Subsequent
 * `loadEnv()` calls (no arg) will reuse the cached extended schema rather
 * than falling back to `baseEnvSchema`.
 *
 * Stickiness matters because `ConfigService` and the `@Value()` decorator
 * both read through the no-arg form internally. Without it, resolving
 * either of them after a `loadEnv(extendedSchema)` call would silently
 * downgrade the env to the base shape and drop every user-defined key.
 *
 * To force a re-parse with a different schema, pass the new schema explicitly.
 * To start fresh, call `resetEnvCache()` (full reset) or `reloadEnv()`
 * (re-parse against the same schema after a `.env` file change).
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
  const s = schema ?? cachedSchema ?? getBaseEnvSchema()
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
 * Reload env from `process.env`. Re-reads `.env` via dotenv (if
 * installed), then re-parses the result against the **same** schema
 * the project registered at startup. Called during HMR rebuild and by
 * `envWatchPlugin` to pick up `.env` file changes mid-session.
 *
 * Crucially, this preserves the registered schema. Wiping it would
 * silently downgrade `ConfigService` and `@Value()` back to the base
 * schema on the next read, so every user-defined key would start
 * resolving as `undefined` after the first `.env` save — which was the
 * original "config disappears in dev" bug.
 *
 * If you need to fully forget the schema (e.g. tests that swap schemas
 * between cases), call {@link resetEnvCache} instead.
 */
export function reloadEnv(): void {
  // Re-read .env file into process.env if dotenv is installed.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config({ override: true, quiet: true })
  } catch {
    // dotenv not installed — nothing to reload, env comes from the
    // environment directly.
  }

  // Drop the parsed snapshot but keep the schema. Re-parse eagerly so
  // existing consumers (including ConfigService getters and @Value
  // resolvers that may already hold references to the env state) see
  // the new values on their very next read instead of having to
  // re-trigger any cache-population step.
  cachedEnv = null
  if (cachedSchema) {
    if (typeof cachedSchema.parse === 'function') {
      loadEnv(cachedSchema)
    } else {
      loadEnvFromSchema(cachedSchema)
    }
  }
}

/**
 * Fully reset the env cache, including the registered schema. Use this
 * in tests that need to swap schemas between cases — `reloadEnv()`
 * deliberately preserves the schema to avoid the "user keys vanish on
 * `.env` reload" footgun.
 */
export function resetEnvCache(): void {
  cachedEnv = null
  cachedSchema = null
}

/**
 * Schema-agnostic env loader. Accepts any schema supported by
 * `@forinda/kickjs-schema` (Zod, Valibot, Yup, Joi, Standard Schema,
 * KickSchema adapters, or plain validator functions).
 *
 * Unlike `loadEnv()` which uses Zod's `.parse()` and throws a
 * `ZodError`, this function uses `detectSchema().safeParse()` and
 * throws a plain `Error` with structured issue messages on failure.
 *
 * @example
 * ```ts
 * import * as v from 'valibot'
 * import { fromValibot } from '@forinda/kickjs-schema/valibot'
 *
 * const envSchema = fromValibot(v.object({
 *   PORT: v.pipe(v.string(), v.transform(Number)),
 *   NODE_ENV: v.picklist(['development', 'production', 'test']),
 * }))
 *
 * export const env = loadEnvFromSchema(envSchema)
 * ```
 */
/**
 * Single inferring signature. `TSchema` is inferred from the call site;
 * the conditional return type maps the unknown-input case (TSchema
 * resolves to `unknown` only when the argument is `unknown`-typed
 * because nothing on the value side carried a richer brand) to
 * `Record<string, unknown>` rather than letting `InferSchemaOutput`
 * fall through to `unknown`. The previous two-overload form had the
 * generic overload win for `unknown`-typed inputs (`unknown` is
 * assignable to any `TSchema`), so the documented "Record" fallback
 * never actually applied.
 */
export function loadEnvFromSchema<TSchema>(
  schema: TSchema,
): unknown extends TSchema ? Record<string, unknown> : InferSchemaOutput<TSchema>
export function loadEnvFromSchema(schema: unknown): unknown {
  const wrapped = detectSchema(schema)
  const result = wrapped.safeParse(process.env)
  if (!result.success) {
    const details = result.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Environment validation failed:\n${details}`)
  }
  cachedEnv = result.data
  cachedSchema = schema
  Container._envResolver = (key: string) => cachedEnv?.[key]
  return result.data
}

/**
 * Output type of {@link baseEnvSchema}. Hand-written (rather than
 * `z.infer<typeof baseEnvSchema>`) so the type is available without the
 * eager `zod` value import — `baseEnvSchema` is now a lazy Proxy typed
 * as `z.ZodObject<any>`, from which `z.infer` could not recover the
 * precise shape anyway.
 */
export type Env = {
  PORT: number
  NODE_ENV: 'development' | 'production' | 'test'
  LOG_LEVEL: string
}
