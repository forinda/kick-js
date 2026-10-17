// Kept out of express.ts: the root entry re-exports that file, and its typings
// must not import from 'express' — an app on Fastify or h3 needn't have it.
import type { Express, Request, Response } from 'express'

/**
 * The Express runtime's native types — what `AdapterContext.app` and
 * `getRuntimeApp()` are typed as once `kick typegen` writes the
 * `KickRuntimeRegister` augmentation for `runtime: 'express'`. Mirrors
 * `FastifyRuntimeTypes` / `H3RuntimeTypes`; import it from
 * `@forinda/kickjs/express`, which needs `@types/express`.
 */
export interface ExpressRuntimeTypes {
  request: Request
  response: Response
  app: Express
}
