import { defineEnv, loadEnv } from '@forinda/kickjs/config'
import { z } from 'zod'

/**
 * Project environment schema.
 *
 * Extend the base schema with your application's variables. The
 * default export is the contract `kick typegen` reads to populate
 * the global `KickEnv` registry — that's what makes `@Value('FOO')`
 * autocomplete and `process.env.FOO` typed.
 *
 * @example
 *   DATABASE_URL: z.string().url(),
 *   JWT_SECRET: z.string().min(32),
 *   REDIS_URL: z.string().url().optional(),
 */
const envSchema = defineEnv((base) =>
  base.extend({
    // DATABASE_URL: z.string().url(),
  }),
)

/**
 * IMPORTANT — side effect: register the schema with kickjs's env cache
 * **at module-load time**. `ConfigService` and `@Value()` both consume
 * this cache, and they will fall back to the base schema (or undefined)
 * if no extended schema has been registered before they're resolved.
 *
 * As long as `src/index.ts` imports this file (`import './env'`) at the
 * top — before `bootstrap()` runs — every controller and service in the
 * app sees the typed extended values.
 */
export const env = loadEnv(envSchema)

export default envSchema
