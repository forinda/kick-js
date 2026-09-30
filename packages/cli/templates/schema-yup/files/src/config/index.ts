import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromYup } from '@forinda/kickjs-schema/yup'
import * as yup from 'yup'

/**
 * Project environment schema (Yup).
 *
 * `fromYup` wraps the Yup schema as a `KickSchema` so the env loader,
 * validate middleware, and swagger spec generator all see the same
 * shape. The default export is the contract `kick typegen` reads to
 * populate `KickEnv` via `InferSchemaOutput<typeof _envSchema>`.
 *
 * Note: Yup's `.url()` defaults to http/https; database connection
 * strings like `postgres://` use `.matches(/^[a-z]+:\/\/.+/i)` or
 * a plain `.string().required()`.
 *
 * @example
 *   DATABASE_URL: yup.string().required(),
 *   JWT_SECRET:   yup.string().min(32).required(),
 *   REDIS_URL:    yup.string().url().optional(),
 */
const envSchema = fromYup(
  yup.object({
    PORT: yup.number().default(3000),
    NODE_ENV: yup.string().oneOf(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: yup.string().default('info'),
    // DATABASE_URL: yup.string().required(),
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
