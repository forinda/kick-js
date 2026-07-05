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
import { createRequestStore, disposeRequestStore } from '../middleware/request-scope'
import { validate } from '../middleware/validate'
import { applyUploadConfig, type RawUploadPart } from '../middleware/upload'
import type {
  ConnectMiddleware,
  HttpRuntime,
  RouteEntry,
  RouteTable,
  RuntimeAppOptions,
  RuntimeResponse,
  UseConnectOptions,
} from '../runtime'

// ESM-safe require for the optional peers (fastify / @fastify/middie /
// serve-static), resolved from wherever this module is installed.
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
  /** Present once @fastify/multipart is registered — async iterator of parts. */
  parts?: () => AsyncIterableIterator<MultipartPart>
  isMultipart?: () => boolean
}
type FastifyHandler = (request: FastifyRequestLike, reply: FastifyReplyLike) => void | Promise<void>
interface FastifyAppLike {
  register(plugin: unknown, opts?: unknown): Promise<void> | FastifyAppLike
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
// Set during mountRoutes when any route carries @FileUpload metadata, so
// nodeHandler knows to register @fastify/multipart before ready().
const NEEDS_MULTIPART = Symbol('kickjs.fastify.needsMultipart')
const NOOP_NEXT = (): void => {}

// A @fastify/multipart part as we consume it from `request.parts()`.
interface MultipartPart {
  type: 'file' | 'field'
  fieldname: string
  filename?: string
  mimetype?: string
  value?: unknown
  toBuffer?: () => Promise<Buffer>
}

/**
 * Wrap a Fastify reply so the RequestContext response helpers drive it.
 * A class so the ~12 driver methods live on a shared prototype — the previous
 * object-literal version re-allocated every method closure on each request.
 */
class FastifyReplyDriver implements RuntimeResponse {
  constructor(private readonly reply: FastifyReplyLike) {}
  status(code: number): this {
    this.reply.code(code)
    return this
  }
  json(data: unknown): this {
    this.reply.send(data)
    return this
  }
  send(data: unknown): this {
    this.reply.send(data)
    return this
  }
  type(contentType: string): this {
    this.reply.type(contentType)
    return this
  }
  setHeader(name: string, value: unknown): this {
    this.reply.header(name, value)
    return this
  }
  render(): never {
    throw new Error('ctx.render() is not supported on the Fastify runtime (no view engine).')
  }
  writeHead(statusCode: number, headers?: Record<string, string | number | string[]>): this {
    // Streaming / SSE: take over the raw socket so Fastify doesn't try to
    // serialize a reply we're writing by hand.
    this.reply.hijack()
    this.reply.raw.writeHead(statusCode, headers)
    return this
  }
  flushHeaders(): this {
    ;(this.reply.raw as ServerResponse & { flushHeaders?: () => void }).flushHeaders?.()
    return this
  }
  write(chunk: unknown): boolean {
    return this.reply.raw.write(chunk as never)
  }
  end(data?: unknown): this {
    this.reply.raw.end(data as never)
    return this
  }
  once(event: string, listener: (...args: unknown[]) => void): this {
    this.reply.raw.once(event, listener)
    return this
  }
  get headersSent(): boolean {
    return this.reply.sent || this.reply.raw.headersSent
  }
}

function replyDriver(reply: FastifyReplyLike): RuntimeResponse {
  return new FastifyReplyDriver(reply) as unknown as RuntimeResponse
}

/** Build the Fastify per-route handler that runs the kickjs pipeline. */
function routeHandler(entry: RouteEntry): FastifyHandler {
  // Validation middleware is built ONCE per route (parity with the Express
  // materializer) — `validate()` constructs a fresh closure, so calling it
  // per request was pure allocation waste.
  const validator = entry.meta.validation ? validate(entry.meta.validation) : undefined
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
      file?: unknown
      files?: unknown
    }
    raw.body = request.body
    raw.params = request.params
    raw.query = request.query

    // @FileUpload: buffer multipart parts into the multer-shaped file(s) that
    // `ctx.file` / `ctx.files` expose. Fastify doesn't parse multipart natively
    // — @fastify/multipart (registered in nodeHandler when any route needs it)
    // provides `request.parts()`. Non-file fields are merged onto `raw.body` so
    // validation / `ctx.body` see them, matching multer's req.body behavior.
    if (entry.meta.upload && entry.meta.upload.mode !== 'none') {
      if (typeof request.parts !== 'function') {
        throw new Error(
          "@forinda/kickjs: @FileUpload on the Fastify runtime requires '@fastify/multipart'.\n" +
            'Install it as a peer dependency: pnpm add @fastify/multipart.',
        )
      }
      const rawParts: RawUploadPart[] = []
      const fields: Record<string, unknown> = {}
      for await (const part of request.parts()) {
        if (part.type === 'file' && part.toBuffer) {
          rawParts.push({
            fieldname: part.fieldname,
            filename: part.filename ?? '',
            mimetype: part.mimetype ?? 'application/octet-stream',
            buffer: await part.toBuffer(),
          })
        } else {
          fields[part.fieldname] = part.value
        }
      }
      const { file, files } = applyUploadConfig(rawParts, entry.meta.upload)
      raw.file = file
      raw.files = files
      raw.body = { ...(raw.body as Record<string, unknown> | undefined), ...fields }
    }

    const headerId = raw.headers['x-request-id']
    const requestId = (Array.isArray(headerId) ? headerId[0] : headerId) || raw.requestId
    const store = createRequestStore(requestId)
    // Propagate the resolved id back onto the raw request so anything reading
    // `req.requestId` inside the frame (e.g. request-logger) matches the store
    // and the X-Request-Id response header — parity with Express.
    raw.requestId = store.requestId

    // @PreDestroy teardown for REQUEST-scoped instances once the response
    // closes (finished or aborted) — parity with requestScopeMiddleware.
    reply.raw.once('close', () => disposeRequestStore(store))

    await requestStore.run(store, async () => {
      const ctx = new RequestContext(raw as never, reply as never, NOOP_NEXT, replyDriver(reply))

      // Validation (from @Get(path, schema) / route.validation). `validator` is a
      // connect-style middleware built once at route registration; it mutates
      // req.body/query/params to the parsed value and calls next(err) on failure
      // — it never touches `res`, so it runs cleanly here. A rejection
      // propagates to the error handler (422).
      if (validator) {
        await new Promise<void>((resolve, reject) => {
          validator(raw as never, undefined as never, (err?: unknown) =>
            err ? reject(err) : resolve(),
          )
        })
      }

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
        // Match Express / h3 routing leniency: `/api/v1/hello` and
        // `/api/v1/hello/` resolve to the same route. Without this, Fastify's
        // strict router 404s a trailing-slash request — e.g. a controller's
        // root `@Get('/')` (mounted at the prefix) misses `${prefix}/`. Set under
        // `routerOptions` (Fastify 5+; top-level `ignoreTrailingSlash` is
        // deprecated, removed in Fastify 6).
        routerOptions: { ignoreTrailingSlash: true },
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
        [NEEDS_MULTIPART]?: boolean
      }
      if (!state[READY]) {
        state[READY] = (async () => {
          // Register @fastify/multipart first when any route uses @FileUpload so
          // `request.parts()` is available. Our applyUploadConfig enforces the
          // real per-file maxSize, so give the plugin a generous fileSize ceiling
          // (its 1MB default would silently truncate larger uploads first).
          if (state[NEEDS_MULTIPART]) {
            const multipart = loadPeer('@fastify/multipart')
            await app.register(multipart, { limits: { fileSize: Number.MAX_SAFE_INTEGER } })
          }
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
          if (entry.meta.upload) (app as { [NEEDS_MULTIPART]?: boolean })[NEEDS_MULTIPART] = true
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
      // Serve via `serve-static` (the standalone connect middleware behind
      // express.static) so the Fastify runtime carries no `express` dependency —
      // queued like any other connect middleware, bridged through middie.
      const serveStatic = loadPeer('serve-static')
      this.useConnect(app, serveStatic(dir) as ConnectMiddleware, { path: prefix })
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
      uploads: true,
      connectMiddleware: true,
      nativeBodyParsing: true,
    },
  }
}

/**
 * The Fastify runtime's engine-native types — what the runtime-typed escape
 * hatches resolve to once the `kick/runtime` typegen emits a `KickRuntimeRegister`
 * augmentation pointing here (spec §4.3b). `AdapterContext.app` / `getRuntimeApp()`
 * become `FastifyInstance`; `ctx.req` / `ctx.res` the Fastify request / reply.
 * Mirrors {@link import('../runtime').ExpressRuntimeTypes} for the default engine.
 */
export interface FastifyRuntimeTypes {
  request: import('fastify').FastifyRequest
  response: import('fastify').FastifyReply
  app: import('fastify').FastifyInstance
}

/** Join a mount prefix and a route path into one URL, collapsing slashes. */
function joinPath(mountPath: string, path: string): string {
  const a = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
  // A root route path ('/' or '') maps to the mount prefix itself — otherwise a
  // controller `@Post('/')` would register at `${prefix}/`, and a request to
  // `${prefix}` (no trailing slash) wouldn't match under Fastify's strict router.
  if (path === '/' || path === '') return a === '' ? '/' : a
  const b = path.startsWith('/') ? path : `/${path}`
  return `${a}${b}`
}
