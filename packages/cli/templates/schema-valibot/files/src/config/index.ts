import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromValibot } from '@forinda/kickjs-schema/valibot'
import * as v from 'valibot'

/**
 * Project environment schema (Valibot).
 *
 * `fromValibot` wraps the Valibot schema as a `KickSchema` so the
 * env loader, validate middleware, and swagger spec generator all see
 * the same shape. The default export is the contract `kick typegen`
 * reads to populate `KickEnv` via `InferSchemaOutput<typeof _envSchema>`
 * — that's what makes `@Value('FOO')` autocomplete and
 * `process.env.FOO` typed.
 *
 * @example
 *   DATABASE_URL: v.pipe(v.string(), v.url()),
 *   JWT_SECRET:   v.pipe(v.string(), v.minLength(32)),
 *   REDIS_URL:    v.optional(v.pipe(v.string(), v.url())),
 */
const envSchema = fromValibot(
  v.object({
    PORT: v.optional(v.pipe(v.string(), v.transform(Number)), '3000'),
    NODE_ENV: v.optional(v.picklist(['development', 'production', 'test']), 'development'),
    LOG_LEVEL: v.optional(v.string(), 'info'),
    // DATABASE_URL: v.pipe(v.string(), v.url()),
  }),
)

/**
 * IMPORTANT — side effect: register the schema with kickjs's env cache
 * **at module-load time**. `ConfigService` and `@Value()` both consume
 * this cache, and they will fall back to the base schema (or undefined)
 * if no extended schema has been registered before they're resolved.
 *
 * As long as `src/index.ts` imports this file (`import './config'`) at
 * the top — before `bootstrap()` runs — every controller and service
 * in the app sees the typed extended values.
 */
export const env = loadEnvFromSchema(envSchema)

export default envSchema
