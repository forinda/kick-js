/**
 * The app as a request handler, with no listening server of its own — for
 * platforms that hand you requests instead of a port: Netlify Functions,
 * Vercel Functions, and any other serverless or embedding host.
 *
 * @module @forinda/kickjs/http/handler
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Application, type ApplicationOptions } from './application'

/** A KickJS app exposed as request handlers. See {@link createHandler}. */
export interface KickHandler {
  /**
   * Web-standard handler: `fetch(Request) → Response`. Netlify Functions,
   * Vercel's fetch export, and anything else that speaks `Request`.
   */
  fetch(request: Request): Promise<Response>
  /** Node handler: `(req, res)`. Vercel Node functions, `http.createServer`. */
  node(req: IncomingMessage, res: ServerResponse): Promise<void>
  /** Set the app up now instead of on the first request (warm-up). */
  ready(): Promise<Application>
  /** Shut adapters down and stop the internal forwarding server, if one started. */
  close(): Promise<void>
}

/**
 * Build a KickJS app as request handlers instead of a listening server.
 *
 * Takes the same options as `bootstrap()`. The app is set up once per process
 * (per function instance), lazily on the first request, and reused after that.
 * Nothing listens on a port, `afterStart` does not run, and no process signal
 * handlers are registered — the platform owns the process.
 *
 * `fetch` uses the runtime's own fetch when it has one (the h3 v2 runtime).
 * Runtimes built on Node request/response objects — Express, the default —
 * are served through a server bound to `127.0.0.1` on a random port inside the
 * same process, started on first use: the `Request` is forwarded to it and its
 * response returned. Request bodies are buffered on that path; response bodies
 * stream. Adapters that rewrite the `res` prototype (Express does) make a
 * direct Request→`res` bridge unreliable, which is why this forwards instead.
 *
 * One handler per process: the DI container is process-wide.
 *
 * @example
 * ```ts
 * // server/src/serverless.ts
 * import 'reflect-metadata'
 * import './config'
 * import { createHandler } from '@forinda/kickjs'
 * import { modules } from './modules'
 *
 * export const handler = createHandler({ modules })
 *
 * // netlify/functions/api.mjs
 * export default (request) => handler.fetch(request)
 * export const config = { path: '/api/*' }
 * ```
 */
export function createHandler(options: ApplicationOptions): KickHandler {
  let app: Promise<Application> | undefined

  const ready = (): Promise<Application> => {
    app ??= (async () => {
      const instance = new Application(options)
      try {
        await instance.startWithoutServer()
      } catch (err) {
        // A failed setup (a database that was briefly down, say) is retried on
        // the next request. Shut this attempt down first so its adapters don't
        // stay live next to the retry's.
        app = undefined
        await instance.shutdown().catch(() => {})
        throw err
      }
      return instance
    })()
    return app
  }

  return {
    ready,

    async fetch(request) {
      return (await ready()).fetch(request)
    },

    async node(req, res) {
      const instance = await ready()
      instance.handle(req, res)
    },

    async close() {
      const current = app
      app = undefined
      if (current) await (await current).shutdown()
    },
  }
}
