/**
 * Serve web `Request`s through a Node request handler by forwarding them to a
 * server bound to `127.0.0.1` inside the same process. Used by
 * `Application.fetch()` for runtimes without a native fetch (Express, Fastify,
 * h3 v1): their handlers need real Node request/response objects, and Express
 * swaps the `res` prototype, which makes a direct Request→`res` bridge
 * unreliable.
 *
 * @module @forinda/kickjs/http/loopback
 */
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

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

const HOP_BY_HOP_RESPONSE = [
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'trailer',
  'content-encoding',
  'content-length',
]

export interface Loopback {
  /** Forward a Request to the handler; starts the server on first use. */
  fetch(request: Request): Promise<Response>
  /** Stop the server, if it started. */
  close(): Promise<void>
}

/**
 * The request body as a stream, without buffering it — so the app's body
 * parsers enforce their size limits as it arrives. A body that turns out to be
 * empty becomes `undefined`: Node's fetch rejects an empty stream on POST.
 */
async function streamedBody(request: Request): Promise<ReadableStream<Uint8Array> | undefined> {
  if (!request.body || request.method === 'GET' || request.method === 'HEAD') return undefined
  const reader = request.body.getReader()
  const first = await reader.read()
  if (first.done) return undefined
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first.value)
    },
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

export function createLoopback(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
): Loopback {
  let started: Promise<{ origin: string; server: http.Server }> | undefined

  const server = () => {
    started ??= new Promise<{ origin: string; server: http.Server }>((resolve, reject) => {
      const instance = http.createServer((req, res) => handle(req, res))
      instance.once('error', reject)
      instance.listen(0, '127.0.0.1', () => {
        // Never keep a process alive on its own account.
        instance.unref()
        resolve({
          origin: `http://127.0.0.1:${(instance.address() as AddressInfo).port}`,
          server: instance,
        })
      })
    }).catch((err) => {
      started = undefined
      throw err
    })
    return started
  }

  return {
    async fetch(request) {
      const { origin } = await server()
      const url = new URL(request.url)

      const headers = new Headers(request.headers)
      for (const name of HOP_BY_HOP_REQUEST) headers.delete(name)
      // The forwarded request arrives from 127.0.0.1. Host and protocol come
      // from the Request's URL — never from caller-supplied forwarding
      // headers, which a trusting runtime would otherwise believe.
      headers.set('x-forwarded-host', url.host)
      headers.set('x-forwarded-proto', url.protocol.slice(0, -1))

      const body = await streamedBody(request)
      const upstream = await fetch(origin + url.pathname + url.search, {
        method: request.method,
        headers,
        body,
        // Required by Node's fetch for a streamed request body.
        ...(body ? { duplex: 'half' } : {}),
        redirect: 'manual',
        signal: request.signal,
      } as RequestInit)

      // Node's fetch has already decoded a compressed body, so the encoding and
      // length headers no longer describe what is being returned. Connection
      // headers describe the loopback hop.
      const responseHeaders = new Headers(upstream.headers)
      const named = responseHeaders.get('connection')?.split(',') ?? []
      for (const name of [...HOP_BY_HOP_RESPONSE, ...named]) responseHeaders.delete(name.trim())
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      })
    },

    async close() {
      const running = await started?.catch(() => undefined)
      started = undefined
      if (!running) return
      const closed = new Promise<void>((resolve) => running.server.close(() => resolve()))
      // Application.shutdown has already drained in-flight requests; what is
      // left is keep-alive sockets from fetch's pool, which would hold
      // close() open past the shutdown timeout.
      running.server.closeAllConnections()
      await closed
    },
  }
}
