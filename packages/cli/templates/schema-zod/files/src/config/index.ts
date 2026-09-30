import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

/**
 * Project environment schema (Zod).
 *
 * `fromZod` wraps the Zod schema as a `KickSchema` so the env loader,
 * validate middleware, and swagger spec generator all see the same
 * shape. The default export is the contract `kick typegen` reads to
 * populate `KickEnv` via `InferSchemaOutput<typeof _envSchema>` —
 * that's what makes `@Value('FOO')` autocomplete and
 * `process.env.FOO` typed.
 *
 * @example
 *   DATABASE_URL: z.string().url(),
 *   JWT_SECRET: z.string().min(32),
 *   REDIS_URL: z.string().url().optional(),
 */
const envSchema = fromZod(
  z.object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    // DATABASE_URL: z.string().url(),
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
