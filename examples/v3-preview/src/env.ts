import { defineEnv } from '@forinda/kickjs'
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
export default defineEnv((base) =>
  base.extend({
    APP_NAME: z.string().default('v3-preview'),
    APP_GREETING: z.string().min(1),
  }),
)
