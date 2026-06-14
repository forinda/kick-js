// The Fastify runtime — `@forinda/kickjs/fastify`.
//
// Implements the same HttpRuntime contract as expressRuntime, over Fastify 5.
// KickJS still owns decorators → RouteTable, the contributor pipeline, and the
// RequestContext surface; this runtime materializes routes as NATIVE Fastify
// routes and wraps `reply` in a RuntimeResponse so `ctx.json` / `ctx.html` /
// `ctx.sse` work unchanged.
//
// `fastify`, `@fastify/middie` are optional peers — install them alongside
// `@forinda/kickjs` to use this subpath.
//
// Lifecycle note: Fastify registration (`register` / `use` / `route`) is
// deferred until `ready()`. Connect middleware needs `@fastify/middie`
// registered first, so `useConnect` only QUEUES middleware; `nodeHandler`
// registers middie, then the queued middleware, then awaits `ready()`.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'

import { RequestContext } from '../context'
import { requestStore } from '../request-store'
import { createRequestStore } from '../middleware/request-scope'
import type {
  ConnectMiddleware,
  HttpRuntime,
  RouteEntry,
  RouteTable,
  RuntimeAppOptions,
  RuntimeResponse,
  UseConnectOptions,
} from '../runtime'

// ESM-safe require for the optional peers (fastify / @fastify/middie / express),
// resolved from wherever this module is installed.
const peerRequire = createRequire(import.meta.url)
const loadPeer = (name: string): any => {
  const mod = peerRequire(name)
  return mod && mod.__esModule && mod.default ? mod.default : (mod.default ?? mod)
}

// Minimal structural surface we use from Fastify — avoids a hard type dep so
// the root package never needs `fastify` installed to typecheck.
interface FastifyReplyLike {
  code(statusCode: number): FastifyReplyLike
  send(payload?: unknown): FastifyReplyLike
  header(name: string, value: unknown): FastifyReplyLike
  type(contentType: string): FastifyReplyLike
  hijack(): void
  readonly sent: boolean
  readonly raw: ServerResponse
}
interface FastifyRequestLike {
  raw: IncomingMessage
  body?: unknown
  params?: unknown
  query?: unknown
}
type FastifyHandler = (request: FastifyRequestLike, reply: FastifyReplyLike) => void | Promise<void>
interface FastifyAppLike {
  register(plugin: unknown): Promise<void> | FastifyAppLike
  use(path: unknown, mw?: unknown): unknown
  route(opts: { method: string; url: string; handler: FastifyHandler }): unknown
  setNotFoundHandler(handler: FastifyHandler): unknown
  setErrorHandler(
    handler: (err: unknown, req: FastifyRequestLike, reply: FastifyReplyLike) => void,
  ): unknown
  ready(): Promise<void>
  routing(req: IncomingMessage, res: ServerResponse): void
}

const QUEUE = Symbol('kickjs.fastify.connectQueue')
const READY = Symbol('kickjs.fastify.ready')
const NEXT = Symbol('kickjs.fastify.next')
const NOOP_NEXT = (): void => {}

/** Wrap a Fastify reply so the RequestContext response helpers drive it. */
function replyDriver(reply: FastifyReplyLike): RuntimeResponse {
  const driver: RuntimeResponse = {
    status(code) {
      reply.code(code)
      return driver
    },
    json(data) {
      reply.send(data)
      return driver
    },
    send(data) {
      reply.send(data)
      return driver
    },
    type(contentType) {
      reply.type(contentType)
      return driver
    },
    setHeader(name, value) {
      reply.header(name, value)
      return driver
    },
    render() {
      throw new Error('ctx.render() is not supported on the Fastify runtime (no view engine).')
    },
    writeHead(statusCode, headers) {
      // Streaming / SSE: take over the raw socket so Fastify doesn't try to
      // serialize a reply we're writing by hand.
      reply.hijack()
      reply.raw.writeHead(statusCode, headers)
      return driver
    },
    flushHeaders() {
      ;(reply.raw as ServerResponse & { flushHeaders?: () => void }).flushHeaders?.()
      return driver
    },
    write(chunk) {
      return reply.raw.write(chunk)
    },
    end(data) {
      reply.raw.end(data)
      return driver
    },
    once(event, listener) {
      reply.raw.once(event, listener)
      return driver
    },
    get headersSent() {
      return reply.sent || reply.raw.headersSent
    },
  }
  return driver
}

/** Build the Fastify per-route handler that runs the kickjs pipeline. */
function routeHandler(entry: RouteEntry): FastifyHandler {
  return async (request, reply) => {
    // Fastify runs the route handler OUTSIDE the connect-middleware chain, so
    // (unlike Express) the requestScopeMiddleware ALS frame isn't active here.
    // Establish it around the pipeline so REQUEST-scoped DI, contributors, and
    // ctx.set/get work. Reuse the inbound x-request-id, or the id a connect
    // middleware (requestId / requestScope, run earlier via middie) already
    // stamped on the raw request, before generating a fresh one.
    // Use the raw node request as `ctx.req`: it natively provides the stream
    // events (`on('close')` / `once`) that SSE and `ctx.signal` need — Fastify's
    // request object doesn't. Copy Fastify's parsed body/params/query onto it so
    // `ctx.body` / `ctx.params` / `ctx.query` keep working.
    const raw = request.raw as IncomingMessage & {
      requestId?: string
      body?: unknown
      params?: unknown
      query?: unknown
    }
    raw.body = request.body
    raw.params = request.params
    raw.query = request.query

    const headerId = raw.headers['x-request-id']
    const requestId = (Array.isArray(headerId) ? headerId[0] : headerId) || raw.requestId
    const store = createRequestStore(requestId)
    // Propagate the resolved id back onto the raw request so anything reading
    // `req.requestId` inside the frame (e.g. request-logger) matches the store
    // and the X-Request-Id response header — parity with Express.
    raw.requestId = store.requestId

    await requestStore.run(store, async () => {
      const ctx = new RequestContext(raw as never, reply as never, NOOP_NEXT, replyDriver(reply))

      // Class + method middleware — `(ctx, next)`; await each, stop if it ended
      // the response or called next(err).
      for (const mw of entry.middlewares) {
        let advanced = false
        await new Promise<void>((resolve, reject) => {
          const next = (err?: unknown): void => {
            advanced = true
            if (err) reject(err)
            else resolve()
          }
          Promise.resolve(mw(ctx, next)).catch(reject)
        })
        if (!advanced || reply.sent) return
      }

      if (entry.contributorRunner) await entry.contributorRunner(ctx)
      if (reply.sent) return
      await entry.handler(ctx)
    })
  }
}

/**
 * The Fastify HTTP runtime. Pass to `bootstrap({ runtime: fastifyRuntime() })`.
 * Per spec §10: Fastify's built-in pino logger is disabled (`logger: false`) so
 * the kickjs `requestLogger` middleware stays the single log format.
 */
export function fastifyRuntime(): HttpRuntime<FastifyAppLike> {
  return {
    name: 'fastify',

    createApp(options: RuntimeAppOptions = {}): FastifyAppLike {
      const Fastify = loadPeer('fastify')
      const app = Fastify({
        logger: false,
        // trustProxy passed through for now; core X-Forwarded-For
        // normalization (spec §10 Q1) is a follow-up.
        trustProxy: typeof options.trustProxy === 'function' ? false : options.trustProxy,
      }) as FastifyAppLike & {
        [QUEUE]?: Array<{ mw: ConnectMiddleware; opts?: UseConnectOptions }>
      }
      app[QUEUE] = []
      return app
    },

    nodeHandler(app) {
      // Register middie + queued connect middleware + finalize `ready()` exactly
      // ONCE per app, even though Application may call nodeHandler per request.
      const state = app as {
        [QUEUE]?: Array<{ mw: ConnectMiddleware; opts?: UseConnectOptions }>
        [READY]?: Promise<void>
      }
      if (!state[READY]) {
        state[READY] = (async () => {
          const middie = loadPeer('@fastify/middie')
          await app.register(middie)
          for (const { mw, opts } of state[QUEUE] ?? []) {
            if (opts?.path !== undefined)
              (app.use as (p: unknown, m: unknown) => void)(opts.path, mw)
            else (app.use as (m: unknown) => void)(mw)
          }
          await app.ready()
        })()
      }
      const readyP = state[READY]

      return (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => {
        if (next) (req as IncomingMessage & { [NEXT]?: (err?: unknown) => void })[NEXT] = next
        readyP
          .then(() => app.routing(req, res))
          .catch((err) => {
            if (next) next(err)
          })
      }
    },

    mountRoutes(app, table: RouteTable) {
      for (const { mountPath, routes } of table) {
        for (const entry of routes) {
          const url = joinPath(mountPath, entry.path)
          app.route({ method: entry.method, url, handler: routeHandler(entry) })
        }
      }
    },

    useConnect(app, mw: ConnectMiddleware, opts?: UseConnectOptions) {
      const queue = (
        app as { [QUEUE]?: Array<{ mw: ConnectMiddleware; opts?: UseConnectOptions }> }
      )[QUEUE]
      queue?.push({ mw, opts })
    },

    serveStatic(app, prefix, dir) {
      // Serve via express.static as a connect middleware, queued like any other.
      const expressStatic = loadPeer('express').static
      this.useConnect(app, expressStatic(dir) as ConnectMiddleware, { path: prefix })
    },

    setNotFound(app, mw: ConnectMiddleware) {
      app.setNotFoundHandler((request, reply) => {
        const next = (request.raw as IncomingMessage & { [NEXT]?: (err?: unknown) => void })[NEXT]
        if (next) {
          // Vite dev fall-through: hand the request back to the outer chain.
          reply.hijack()
          next()
          return
        }
        // Pass the reply DRIVER (not raw res) so the connect-style
        // notFoundHandler's `res.status().json()` lands on the Fastify reply.
        ;(mw as (req: unknown, res: unknown, next: () => void) => void)(
          request.raw,
          replyDriver(reply),
          NOOP_NEXT,
        )
      })
    },

    setErrorHandler(app, mw: ConnectMiddleware) {
      app.setErrorHandler((err, request, reply) => {
        // Reply driver (not raw res) so the connect-style errorHandler's
        // `res.status().json()` / `setHeader` land on the Fastify reply.
        ;(mw as (e: unknown, req: unknown, res: unknown, next: () => void) => void)(
          err,
          request.raw,
          replyDriver(reply),
          NOOP_NEXT,
        )
      })
    },

    capabilities: {
      render: false,
      uploads: false,
      connectMiddleware: true,
    },
  }
}

/** Join a mount prefix and a route path into one URL, collapsing slashes. */
function joinPath(mountPath: string, path: string): string {
  const a = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
  const b = path.startsWith('/') ? path : `/${path}`
  const joined = `${a}${b}`
  return joined === '' ? '/' : joined
}
