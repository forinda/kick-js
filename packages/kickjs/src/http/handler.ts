/**
 * The app as a request handler, with no listening server of its own — for
 * platforms that hand you requests instead of a port: Netlify Functions,
 * Vercel Functions, and any other serverless or embedding host.
 *
 * @module @forinda/kickjs/http/handler
 */
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
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
 * Request headers that describe one hop, not the request. Forwarding them
 * makes Node's `fetch` reject the request ("fetch failed") or misframe it —
 * `content-length` is recomputed from the buffered body.
 */
const HOP_BY_HOP_REQUEST = [
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'host',
  'content-length',
]

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
  let forwarding: Promise<{ origin: string; server: http.Server }> | undefined

  const ready = (): Promise<Application> => {
    app ??= (async () => {
      const instance = new Application(options)
      await instance.startWithoutServer()
      return instance
    })().catch((err) => {
      // A failed setup (a database that was briefly down, say) is retried on
      // the next request instead of pinning the instance to a rejected promise.
      app = undefined
      throw err
    })
    return app
  }

  const forwardingServer = (instance: Application) => {
    forwarding ??= new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => instance.handle(req, res))
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        // Never keep a function instance alive on its own account.
        server.unref()
        resolve({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server })
      })
    })
    return forwarding
  }

  const forward = async (instance: Application, request: Request): Promise<Response> => {
    const { origin } = await forwardingServer(instance)
    const url = new URL(request.url)

    const headers = new Headers(request.headers)
    for (const name of HOP_BY_HOP_REQUEST) headers.delete(name)
    // The forwarded request arrives from 127.0.0.1; keep what the platform saw.
    if (!headers.has('x-forwarded-host')) headers.set('x-forwarded-host', url.host)
    if (!headers.has('x-forwarded-proto'))
      headers.set('x-forwarded-proto', url.protocol.slice(0, -1))

    // Buffered: a body-less POST arrives as an empty stream, which Node's fetch
    // rejects, and serverless platforms buffer request bodies anyway.
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer()

    const upstream = await fetch(origin + url.pathname + url.search, {
      method: request.method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      redirect: 'manual',
    })

    // Node's fetch has already decoded a compressed body, so the encoding and
    // length headers no longer describe what is being returned.
    const responseHeaders = new Headers(upstream.headers)
    responseHeaders.delete('content-encoding')
    responseHeaders.delete('content-length')
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  }

  return {
    ready,

    async fetch(request) {
      const instance = await ready()
      const runtimeApp = instance.getRuntimeApp() as { fetch?: (request: Request) => unknown }
      if (typeof runtimeApp?.fetch === 'function') {
        return (await runtimeApp.fetch(request)) as Response
      }
      return forward(instance, request)
    },

    async node(req, res) {
      const instance = await ready()
      instance.handle(req, res)
    },

    async close() {
      const started = forwarding
      forwarding = undefined
      if (started) {
        const { server } = await started
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
      const current = app
      app = undefined
      if (current) await (await current).shutdown()
    },
  }
}
