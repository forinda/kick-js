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

import { RequestContext } from '../context'
import { requestStore } from '../request-store'
import { createRequestStore } from '../middleware/request-scope'
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
const NOOP_NEXT = (): void => {}
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Wrap a node ServerResponse (from `event.node.res`) as a RuntimeResponse. */
function resDriver(res: ServerResponse): RuntimeResponse {
  const driver: RuntimeResponse = {
    status(code) {
      res.statusCode = code
      return driver
    },
    json(data) {
      if (!res.headersSent) res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(data))
      return driver
    },
    send(data) {
      res.end(data as never)
      return driver
    },
    type(contentType) {
      res.setHeader('content-type', contentType)
      return driver
    },
    setHeader(name, value) {
      res.setHeader(name, value as never)
      return driver
    },
    render() {
      throw new Error('ctx.render() is not supported on the h3 runtime (no view engine).')
    },
    writeHead(statusCode, headers) {
      res.writeHead(statusCode, headers)
      return driver
    },
    flushHeaders() {
      res.flushHeaders()
      return driver
    },
    write(chunk) {
      return res.write(chunk)
    },
    end(data) {
      res.end(data as never)
      return driver
    },
    once(event, listener) {
      res.once(event, listener)
      return driver
    },
    get headersSent() {
      return res.headersSent
    },
  }
  return driver
}

/** Build the h3 event handler that runs the kickjs pipeline for one route. */
function makeEventHandler(entry: RouteEntry): (event: H3EventLike) => Promise<void> {
  const { getRouterParams, getQuery, readBody, readMultipartFormData } = h3()
  const upload = entry.meta.upload
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
      req.body = await readBody(event).catch(() => undefined)
    }

    const headerId = req.headers['x-request-id']
    const requestId = (Array.isArray(headerId) ? headerId[0] : headerId) || req.requestId
    const store = createRequestStore(requestId)
    req.requestId = store.requestId

    await requestStore.run(store, async () => {
      const ctx = new RequestContext(req as never, res as never, NOOP_NEXT, resDriver(res))

      if (entry.meta.validation) {
        const v = validate(entry.meta.validation)
        await new Promise<void>((resolve, reject) => {
          v(req as never, undefined as never, (err?: unknown) => (err ? reject(err) : resolve()))
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
      await entry.handler(ctx)
    })
  }
}

/**
 * The h3 HTTP runtime. Pass to `bootstrap({ runtime: h3Runtime() })`.
 * h3 parses bodies itself (`readBody`), so the Application skips its default
 * `express.json()` (see `nativeBodyParsing`).
 */
export function h3Runtime(): HttpRuntime<H3AppLike> {
  return {
    name: 'h3',

    createApp(_options: RuntimeAppOptions = {}): H3AppLike {
      const { createApp } = h3()
      const app = createApp({
        onError: (error: unknown, event: H3EventLike) => {
          const mw = (app as { [ERROR_MW]?: ConnectMiddleware })[ERROR_MW]
          if (mw && !event.node.res.writableEnded) {
            ;(mw as (e: unknown, req: unknown, res: unknown, next: () => void) => void)(
              error,
              event.node.req,
              resDriver(event.node.res),
              NOOP_NEXT,
            )
          }
        },
      })
      return app as H3AppLike
    },

    nodeHandler(app) {
      const { toNodeListener } = h3()
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
      const router = createRouter()
      for (const { mountPath, routes } of table) {
        for (const entry of routes) {
          const url = joinPath(mountPath, entry.path)
          const method = entry.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'
          router[method](url, eventHandler(makeEventHandler(entry)))
        }
      }
      app.use(router)
    },

    useConnect(app, mw: ConnectMiddleware, opts?: UseConnectOptions) {
      const { fromNodeMiddleware } = h3()
      const handler = fromNodeMiddleware(mw)
      if (opts?.path !== undefined) app.use(opts.path, handler)
      else app.use(handler)
    },

    serveStatic(app, prefix, dir) {
      const expressStatic = peerRequire('express').static
      this.useConnect(app, expressStatic(dir) as ConnectMiddleware, { path: prefix })
    },

    setNotFound(app, mw: ConnectMiddleware) {
      const { eventHandler } = h3()
      // Registered after the router, so it only runs when nothing matched.
      app.use(
        eventHandler((event: H3EventLike) => {
          const next = (event.node.req as IncomingMessage & { [NEXT]?: () => void })[NEXT]
          if (next) {
            next()
            return
          }
          ;(mw as (req: unknown, res: unknown, next: () => void) => void)(
            event.node.req,
            resDriver(event.node.res),
            NOOP_NEXT,
          )
        }),
      )
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
export interface H3RuntimeTypes {
  request: import('h3').H3Event
  response: import('h3').H3Event
  app: import('h3').App
}

/** Join a mount prefix and a route path; a root path maps to the prefix itself. */
function joinPath(mountPath: string, path: string): string {
  const a = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
  if (path === '/' || path === '') return a === '' ? '/' : a
  const b = path.startsWith('/') ? path : `/${path}`
  return `${a}${b}`
}
