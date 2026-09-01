// The h3 runtime — `@forinda/kickjs/h3`.
//
// h3 (unjs) is the HTTP layer behind Nitro / Nuxt. This binds it to the same
// HttpRuntime contract as Express and Fastify: routes become native h3 router
// routes, and the node `ServerResponse` (h3 exposes it as `event.node.res`) is
// wrapped in a RuntimeResponse so `ctx.json` / `ctx.html` / `ctx.sse` work
// unchanged.
//
// Targets h3 **v1** (stable, node-based: `createApp` / `createRouter` /
// `toNodeListener`, with `event.node.req` / `event.node.res`). `h3` is an
// optional peer pinned to `^1`.
//
// h3 v2 (https://h3.dev/migration) moves to a web-standard `Request`/`Response`
// core. Adopting it is the spec's §8 "web-standard driver" — `RuntimeResponse`
// was shaped so a future `webRuntime()` can implement it over WHATWG streams,
// at which point h3 v2 (and edge/Bun/Deno) become a driver swap rather than a
// rewrite. Until that lands, this binding uses the node-compatible v1 surface.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'

import { classifyMediaType, unsupportedMediaTypeError } from '../body-policy'
import { RequestContext } from '../context'
import { applyHandlerResult } from '../reply'
import { requestStore } from '../request-store'
import { createRequestStore, disposeRequestStore } from '../middleware/request-scope'
import { validate } from '../middleware/validate'
import { HttpException } from '../../core/errors'
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

const peerRequire = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h3 = (): any => peerRequire('h3')

interface H3EventLike {
  node: { req: IncomingMessage; res: ServerResponse }
}
interface H3AppLike {
  use(arg1: unknown, arg2?: unknown): unknown
  handler: unknown
}

const NEXT = Symbol('kickjs.h3.next')
const ERROR_MW = Symbol('kickjs.h3.errorMw')
// h3's `createRouter` is terminal — on no match it THROWS a 404, it does not
// fall through to the next `app.use` layer like an Express Router. So every
// route source (controllers, /health, devtools /_debug, ad-hoc adapter routes)
// must live on ONE shared router, registered AFTER all connect middleware.
const ROUTER = Symbol('kickjs.h3.router')
const NOTFOUND_MW = Symbol('kickjs.h3.notFoundMw')
const ASSEMBLED = Symbol('kickjs.h3.assembled')
const NOOP_NEXT = (): void => {}
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Wrap a node ServerResponse (from `event.node.res`) as a RuntimeResponse.
 * A class so the ~12 driver methods live on a shared prototype — the previous
 * object-literal version re-allocated every method closure on each request.
 */
class NodeResDriver implements RuntimeResponse {
  constructor(private readonly res: ServerResponse) {}
  status(code: number): this {
    this.res.statusCode = code
    return this
  }
  json(data: unknown): this {
    // Do not clobber a content-type the caller already chose. This used to set
    // `application/json` unconditionally, so every `application/problem+json`
    // response — RFC 9457 problem details, which the error handler sets the
    // header for before serialising — went out as plain JSON on this runtime
    // alone. Express and Fastify both leave an existing value alone.
    if (!this.res.headersSent && !this.res.getHeader('content-type')) {
      this.res.setHeader('content-type', 'application/json; charset=utf-8')
    }
    this.res.end(JSON.stringify(data))
    return this
  }
  send(data: unknown): this {
    this.res.end(data as never)
    return this
  }
  type(contentType: string): this {
    this.res.setHeader('content-type', contentType)
    return this
  }
  setHeader(name: string, value: unknown): this {
    this.res.setHeader(name, value as never)
    return this
  }
  render(): never {
    throw new Error('ctx.render() is not supported on the h3 runtime (no view engine).')
  }
  writeHead(statusCode: number, headers?: Record<string, string | number | string[]>): this {
    this.res.writeHead(statusCode, headers)
    return this
  }
  flushHeaders(): this {
    this.res.flushHeaders()
    return this
  }
  write(chunk: unknown): boolean {
    return this.res.write(chunk as never)
  }
  end(data?: unknown): this {
    this.res.end(data as never)
    return this
  }
  once(event: string, listener: (...args: unknown[]) => void): this {
    this.res.once(event, listener)
    return this
  }
  get headersSent(): boolean {
    return this.res.headersSent
  }
}

function resDriver(res: ServerResponse): RuntimeResponse {
  return new NodeResDriver(res) as unknown as RuntimeResponse
}

/** Carries `trustProxy` from createApp() to the per-route handlers. */
const TRUST_PROXY = Symbol('kickjs.h3.trustProxy')

/** Build the h3 event handler that runs the kickjs pipeline for one route. */
function makeEventHandler(
  entry: RouteEntry,
  trustProxy: boolean,
): (event: H3EventLike) => Promise<void> {
  const { getRouterParams, getQuery, readRawBody, readMultipartFormData } = h3()
  const upload = entry.meta.upload
  // Validation middleware built ONCE per route (parity with Express) — calling
  // validate() per request re-allocated the closure every time.
  const validator = entry.meta.validation ? validate(entry.meta.validation) : undefined
  return async (event: H3EventLike) => {
    const req = event.node.req as IncomingMessage & {
      requestId?: string
      body?: unknown
      params?: unknown
      query?: unknown
      file?: unknown
      files?: unknown
    }
    const res = event.node.res

    // h3 computes no client address of its own, so `resolveClientIp` fell
    // straight through to the socket — which behind a proxy is the proxy, and
    // put every caller in one rate-limit bucket with no way to configure out
    // of it (#614). Express and Fastify derive `req.ip` from their own
    // trust-proxy settings; this is h3's equivalent, and like theirs it is
    // OFF unless the app opts in, because an unverified `x-forwarded-for` is
    // client-controllable.
    if (trustProxy && !(req as { ip?: string }).ip) {
      const forwarded = req.headers['x-forwarded-for']
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
      if (first) (req as { ip?: string }).ip = first
    }

    // Populate the express-shaped request fields h3 keeps elsewhere.
    req.params = getRouterParams(event) ?? {}
    req.query = getQuery(event) ?? {}
    if (upload && upload.mode !== 'none') {
      // @FileUpload: read the multipart body once (readBody would consume the
      // same stream, so the two are mutually exclusive). File parts → the
      // multer-shaped ctx.file/ctx.files; non-file fields → req.body.
      const form = (await readMultipartFormData(event).catch(() => undefined)) as
        | Array<{ name?: string; filename?: string; type?: string; data: Buffer }>
        | undefined
      const rawParts: RawUploadPart[] = []
      const fields: Record<string, unknown> = {}
      for (const part of form ?? []) {
        if (part.filename) {
          rawParts.push({
            fieldname: part.name ?? '',
            filename: part.filename,
            mimetype: part.type ?? 'application/octet-stream',
            buffer: part.data,
          })
        } else if (part.name) {
          fields[part.name] = part.data.toString('utf-8')
        }
      }
      const { file, files } = applyUploadConfig(rawParts, upload)
      req.file = file
      req.files = files
      req.body = fields
    } else if (BODY_METHODS.has(req.method ?? 'GET')) {
      // Swallow ONLY the absent-body case. `.catch(() => undefined)` also
      // swallowed a malformed one, so h3 answered 200 with the handler running
      // on `undefined` where Express and Fastify both answer 400 — a client
      // sending broken JSON got a success response, and the handler executed
      // against data that was never valid.
      const { 'content-length': length, 'transfer-encoding': encoding } = req.headers
      const sentBody = encoding !== undefined || (length !== undefined && length !== '0')
      if (sentBody) {
        // Read raw and apply the shared policy rather than calling `readBody`,
        // whose own content-type dispatch is the source of the divergence:
        // it matches `application/json` with `===` (so `; charset=utf-8` misses)
        // and routes everything unrecognised through `destr`, which returns the
        // RAW STRING for malformed input instead of throwing (#590).
        const kind = classifyMediaType(req.headers['content-type'])
        if (kind !== 'multipart') {
          const raw = await readRawBody(event, 'utf8')
          // Reject only once the body is known to be non-empty. `sentBody` is
          // true for an empty CHUNKED post — `transfer-encoding` is present
          // with no payload — and rejecting on that alone would 415 a request
          // that sent nothing, contradicting the rule the other runtimes apply.
          if (raw) {
            if (kind === 'unsupported') {
              // A body was sent in a format the framework does not parse. Say
              // so rather than handing the handler `undefined` and letting it
              // fail somewhere less obvious.
              throw unsupportedMediaTypeError(req.headers['content-type'])
            }
            if (kind === 'json') {
              try {
                req.body = JSON.parse(raw)
              } catch (err) {
                throw HttpException.badRequest(
                  err instanceof Error ? err.message : 'Request body could not be parsed',
                )
              }
            } else if (kind === 'urlencoded') {
              req.body = Object.fromEntries(new URLSearchParams(raw))
            } else {
              req.body = raw
            }
          }
        }
      }
    }

    const headerId = req.headers['x-request-id']
    const requestId = (Array.isArray(headerId) ? headerId[0] : headerId) || req.requestId
    const store = createRequestStore(requestId)
    req.requestId = store.requestId

    // @PreDestroy teardown for REQUEST-scoped instances once the response
    // closes (finished or aborted) — parity with requestScopeMiddleware.
    res.once('close', () => disposeRequestStore(store))

    await requestStore.run(store, async () => {
      const ctx = new RequestContext(req as never, res as never, NOOP_NEXT, resDriver(res))

      if (validator) {
        await new Promise<void>((resolve, reject) => {
          validator(req as never, undefined as never, (err?: unknown) =>
            err ? reject(err) : resolve(),
          )
        })
      }

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
        if (!advanced || res.writableEnded) return
      }

      if (entry.contributorRunner) await entry.contributorRunner(ctx)
      if (res.writableEnded) return
      const result = await entry.handler(ctx)
      // Return-value handlers (reply.ts): auto-send when nothing was written.
      if (!res.writableEnded && !res.headersSent) applyHandlerResult(ctx, result)
    })
  }
}

/**
 * The original error h3 wrapped.
 *
 * h3 routes every thrown value through `createError()`, which returns its own
 * error with the original on `cause`. Handing that wrapper to the shared error
 * middleware means it sees something Express and Fastify never give it, and the
 * responses diverge: `instanceof HttpException` fails, so a thrown
 * `HttpException(418)` falls through to the generic branch and picks up a
 * `requestId` the other two omit, and `describeError` walks the cause chain to
 * report `kaboom ← caused by kaboom`.
 *
 * Only an `Error` cause is unwrapped. h3's own 404 carries no cause, so the
 * not-found path above is unaffected.
 */
function unwrapH3Error(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const { cause } = error as { cause?: unknown }
  return cause instanceof Error ? cause : error
}

/**
 * The h3 HTTP runtime. Pass to `bootstrap({ runtime: h3Runtime() })`.
 * h3 parses bodies itself (`readBody`), so the Application skips its default
 * `express.json()` (see `nativeBodyParsing`).
 */
export function h3Runtime(): HttpRuntime<H3AppLike> {
  return {
    name: 'h3',

    createApp(options: RuntimeAppOptions = {}): H3AppLike {
      const { createApp } = h3()
      const app = createApp({
        onError: (error: unknown, event: H3EventLike) => {
          const res = event.node.res
          if (res.writableEnded) return
          const state = app as {
            [ERROR_MW]?: ConnectMiddleware
            [NOTFOUND_MW]?: ConnectMiddleware
          }
          // The shared router throws a 404 on no match (it's terminal). Treat
          // that as "not found", not a server error: hand back to the outer
          // chain (Vite dev fall-through) when present, else run the framework's
          // notFound handler so it returns a proper 404 — only genuine handler
          // errors reach the error middleware (and the ErrorHandler log).
          const status = (error as { statusCode?: number } | undefined)?.statusCode
          if (status === 404) {
            const next = (event.node.req as IncomingMessage & { [NEXT]?: () => void })[NEXT]
            if (next) {
              next()
              return
            }
            const nf = state[NOTFOUND_MW]
            if (nf) {
              ;(nf as (req: unknown, res: unknown, next: () => void) => void)(
                event.node.req,
                resDriver(res),
                NOOP_NEXT,
              )
              return
            }
          }
          const mw = state[ERROR_MW]
          if (mw) {
            ;(mw as (e: unknown, req: unknown, res: unknown, next: () => void) => void)(
              unwrapH3Error(error),
              event.node.req,
              resDriver(res),
              NOOP_NEXT,
            )
          }
        },
      })
      // Stash the setting for mountRoutes — h3 has no app-level config object
      // of its own to hang it on.
      ;(app as { [TRUST_PROXY]?: unknown })[TRUST_PROXY] = options.trustProxy
      return app as H3AppLike
    },

    nodeHandler(app) {
      const { toNodeListener } = h3()
      // Register the shared router exactly once, AFTER all connect middleware
      // (serveStatic / useConnect) the setup phase added via `app.use` — the
      // router is terminal, so anything that must run for non-route paths has to
      // sit before it in the stack.
      const state = app as { [ROUTER]?: unknown; [ASSEMBLED]?: boolean }
      if (!state[ASSEMBLED]) {
        state[ASSEMBLED] = true
        if (state[ROUTER]) app.use(state[ROUTER])
      }
      const listener = toNodeListener(app)
      return (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => {
        if (next) (req as IncomingMessage & { [NEXT]?: (err?: unknown) => void })[NEXT] = next
        Promise.resolve(listener(req, res)).catch((err) => {
          if (next) next(err)
        })
      }
    },

    mountRoutes(app, table: RouteTable) {
      const { createRouter, eventHandler } = h3()
      const trustProxy = Boolean((app as { [TRUST_PROXY]?: unknown })[TRUST_PROXY])
      // One shared router per app — every mountRoutes call (controllers, health,
      // devtools, ad-hoc adapter routes) adds to it. `app.use(router)` is
      // deferred to nodeHandler so the router lands after connect middleware.
      const state = app as { [ROUTER]?: ReturnType<typeof createRouter> }
      if (!state[ROUTER]) state[ROUTER] = createRouter()
      const router = state[ROUTER]
      for (const { mountPath, routes } of table) {
        for (const entry of routes) {
          const url = joinPath(mountPath, entry.path)
          const method = entry.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'
          router[method](url, eventHandler(makeEventHandler(entry, trustProxy)))
        }
      }
    },

    useConnect(app, mw: ConnectMiddleware, opts?: UseConnectOptions) {
      const { fromNodeMiddleware } = h3()
      const handler = fromNodeMiddleware(mw)
      if (opts?.path !== undefined) app.use(opts.path, handler)
      else app.use(handler)
    },

    serveStatic(app, prefix, dir) {
      // `serve-static` (the standalone connect middleware behind express.static)
      // so the h3 runtime carries no `express` dependency — bridged via
      // fromNodeMiddleware like any other connect middleware.
      const serveStatic = peerRequire('serve-static')
      this.useConnect(app, serveStatic(dir) as ConnectMiddleware, { path: prefix })
    },

    setNotFound(app, mw: ConnectMiddleware) {
      // Stash it — the shared router throws a 404 on no match, which `onError`
      // (createApp) dispatches to this handler (or to the Vite fall-through when
      // a `next` is present). A post-router `app.use` could never run, since the
      // terminal router throws before the stack advances.
      ;(app as { [NOTFOUND_MW]?: ConnectMiddleware })[NOTFOUND_MW] = mw
    },

    setErrorHandler(app, mw: ConnectMiddleware) {
      ;(app as { [ERROR_MW]?: ConnectMiddleware })[ERROR_MW] = mw
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
 * The h3 runtime's engine-native types — what the runtime-typed escape hatches
 * resolve to once the `kick/runtime` typegen emits a `KickRuntimeRegister`
 * augmentation pointing here (spec §4.3b). `AdapterContext.app` / `getRuntimeApp()`
 * become the h3 `App`; `ctx.req` / `ctx.res` the per-request `H3Event` (h3 v1
 * routes everything through the event). Mirrors `ExpressRuntimeTypes`.
 */
// Resolved conditionally so this file typechecks against EITHER installed h3
// major: v1 exports `App`; v2 (used by the sibling h3-web runtime) does not.
// Runtime behavior is untouched — this block is type-only.
type H3AppType = typeof import('h3') extends { App: infer A } ? A : unknown
type H3EventType = typeof import('h3') extends { H3Event: new (...args: never[]) => infer E }
  ? E
  : unknown

export interface H3RuntimeTypes {
  request: H3EventType
  response: H3EventType
  app: H3AppType
}

/** Join a mount prefix and a route path; a root path maps to the prefix itself. */
function joinPath(mountPath: string, path: string): string {
  const a = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
  if (path === '/' || path === '') return a === '' ? '/' : a
  const b = path.startsWith('/') ? path : `/${path}`
  return `${a}${b}`
}
