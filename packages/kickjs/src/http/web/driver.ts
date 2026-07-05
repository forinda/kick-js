// Web-standard driver pair — the request/response bridge between web
// primitives (WHATWG Request/Response) and the KickJS RequestContext surface.
//
// Deliberately imports NOTHING from node: this module is the edge-safe core
// shared by the h3 v2 runtime (`runtimes/h3-web.ts`, node bootstrap) and the
// `@forinda/kickjs/web` fetch entry (edge/Bun/Deno). See
// `web-standards-edge-design.md` §3.1.

import type { RuntimeResponse } from '../runtime'

/**
 * Presents a web `Request` as the express-shaped `req` object that
 * `RequestContext` (and route validation) reads: plain-object `headers`,
 * assignable `body`/`params`/`query`, and `on/once('close')` bridged from
 * the request's `AbortSignal` — the only EventEmitter surface the context
 * layer uses (`ctx.signal`, SSE close).
 */
export class WebRequestShim {
  readonly method: string
  readonly url: string
  /** Lower-cased plain header object (RequestContext indexes it directly). */
  readonly headers: Record<string, string>
  body: unknown
  params: Record<string, string> = {}
  query: Record<string, unknown> = {}
  requestId?: string
  file?: unknown
  files?: unknown;
  // Ad-hoc props middleware may set (session, user, ...) — index signature
  // keeps assignment open like a node req object.
  [key: string]: unknown

  private readonly signal: AbortSignal

  constructor(request: Request, url: URL) {
    this.method = request.method
    // Express-shaped `req.url` is path + search, not the absolute URL.
    this.url = url.pathname + url.search
    this.signal = request.signal
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })
    this.headers = headers
    const query: Record<string, unknown> = {}
    for (const key of url.searchParams.keys()) {
      const all = url.searchParams.getAll(key)
      query[key] = all.length > 1 ? all : all[0]
    }
    this.query = query
  }

  /** `req.once('close')` — abort of the underlying request signal. */
  once(event: string, listener: () => void): this {
    if (event === 'close') this.signal.addEventListener('abort', listener, { once: true })
    return this
  }

  /** `req.on('close')` — same bridge; signals only abort once anyway. */
  on(event: string, listener: () => void): this {
    return this.once(event, listener)
  }
}

const encoder = new TextEncoder()

function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk
  return encoder.encode(String(chunk))
}

/**
 * `RuntimeResponse` over a web `Response`.
 *
 * Two modes:
 * - **Buffered** (default): `status/json/send/type/setHeader` record state;
 *   the terminal call resolves {@link ready} with a complete `Response`.
 * - **Streaming**: the first `writeHead`/`flushHeaders`/`write` call switches
 *   to a `TransformStream` and resolves {@link ready} IMMEDIATELY with a
 *   streamed `Response` — SSE works on edge this way; `write` feeds the
 *   writer, `end` closes it.
 *
 * A class so the method table lives on a shared prototype (one allocation
 * per request — same rationale as the Fastify/h3 driver classes).
 */
export class WebResponseDriver implements RuntimeResponse {
  /** Resolves with the final (or streamed) Response. */
  readonly ready: Promise<Response>
  /** True once a terminal/streaming action produced the Response. */
  settled = false

  private _status = 200
  private readonly headers = new Headers()
  private _headersSent = false
  private writer?: WritableStreamDefaultWriter<Uint8Array>
  private resolveReady!: (response: Response) => void

  constructor(private readonly signal?: AbortSignal) {
    this.ready = new Promise<Response>((resolve) => {
      this.resolveReady = resolve
    })
  }

  status(code: number): this {
    this._status = code
    return this
  }

  json(data: unknown): this {
    if (!this.headers.has('content-type'))
      this.headers.set('content-type', 'application/json; charset=utf-8')
    return this.finish(JSON.stringify(data))
  }

  send(data: unknown): this {
    if (
      data !== undefined &&
      data !== null &&
      typeof data === 'object' &&
      !(data instanceof Uint8Array)
    ) {
      return this.json(data)
    }
    return this.finish(data as string | Uint8Array | null | undefined)
  }

  type(contentType: string): this {
    this.headers.set('content-type', contentType)
    return this
  }

  setHeader(name: string, value: unknown): this {
    if (Array.isArray(value)) {
      this.headers.delete(name)
      for (const v of value) this.headers.append(name, String(v))
    } else {
      this.headers.set(name, String(value))
    }
    return this
  }

  render(): never {
    throw new Error('ctx.render() is not supported on the web runtime (no view engine).')
  }

  writeHead(statusCode: number, headers?: Record<string, string | number | string[]>): this {
    this._status = statusCode
    if (headers) {
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value)
    }
    this.startStream()
    return this
  }

  flushHeaders(): this {
    this.startStream()
    return this
  }

  write(chunk: unknown): boolean {
    this.startStream()
    // Fire-and-forget: backpressure is absorbed by the stream's queue. Write
    // failures (client gone) surface via the abort listener, not here.
    void this.writer!.write(toBytes(chunk)).catch(() => {})
    return true
  }

  end(data?: unknown): this {
    if (this.writer) {
      if (data !== undefined) this.write(data)
      void this.writer.close().catch(() => {})
      this.writer = undefined
      return this
    }
    return this.finish(data as string | Uint8Array | null | undefined)
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    if (event === 'close' && this.signal)
      this.signal.addEventListener('abort', listener as () => void, { once: true })
    return this
  }

  get headersSent(): boolean {
    return this._headersSent
  }

  /** Buffered terminal: build the final Response exactly once. */
  private finish(body?: string | Uint8Array | null): this {
    if (this.settled) return this
    this.settled = true
    this._headersSent = true
    // 204/304 must not carry a body per the Response constructor contract.
    const bodyAllowed = this._status !== 204 && this._status !== 304
    this.resolveReady(
      new Response(bodyAllowed ? (body ?? null) : null, {
        status: this._status,
        headers: this.headers,
      }),
    )
    return this
  }

  /** Switch to streaming mode and resolve `ready` with the streamed Response. */
  private startStream(): void {
    if (this.writer || this.settled) return
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    this.writer = writable.getWriter()
    this.settled = true
    this._headersSent = true
    // Abort from the client tears the stream down so the writer stops queueing.
    this.signal?.addEventListener(
      'abort',
      () => {
        void this.writer?.abort().catch(() => {})
        this.writer = undefined
      },
      { once: true },
    )
    this.resolveReady(new Response(readable, { status: this._status, headers: this.headers }))
  }
}
