/**
 * `@CacheResponse` — cache a route's whole response on the server, answer
 * `304` on a matching ETag, and serve a stale copy while a fresh one is built
 * in the background (stale-while-revalidate).
 *
 * The handler runs against a recording of the response: whatever it sends —
 * `ctx.json`, `ctx.send`, `ctx.html`, or a returned value — is captured,
 * replayed onto the real response, and stored when the status is 200. Entries
 * live in the {@link CacheProvider} (`setCacheProvider`), so a shared store
 * such as Redis serves every instance.
 *
 * Edge-safe: no node imports — shared by every runtime and the web entry.
 *
 * @module @forinda/kickjs/http/cache-response
 */
import { getCacheProvider } from '../core/cache'
import { waitUntil } from './background'
import type { RequestContext } from './context'
import { applyHandlerResult } from './reply'
import { stringifyJson, type RuntimeResponse } from './runtime'

export interface CacheResponseOptions {
  /** Seconds a stored response is served as fresh. */
  maxAge: number
  /**
   * Seconds past `maxAge` a stale response is still served, while one request
   * rebuilds it in the background. Default 0: past `maxAge` the next request waits.
   */
  swr?: number
  /**
   * Request headers that select a different response — `accept-language`, or
   * `authorization` for per-user responses. Their values are part of the key.
   * Every header the handler reads belongs here.
   *
   * A request that identifies its caller — `authorization`, `proxy-authorization`,
   * `x-api-key`, a `cookie`, or a signed-in `ctx.user` — skips the cache unless
   * that header is listed here: under a shared key, one user's response would
   * reach another.
   */
  varies?: string[]
  /**
   * A string is the key prefix — `@CacheEvict(prefix)` clears the route's
   * entries. Default: `kick:response:Controller.method`.
   *
   * A function decides the key per request, from the whole context — params,
   * `ctx.get('tenant')`, `ctx.user`. It owns the decision: the caller check
   * above doesn't apply, so include the user or tenant when the response
   * depends on them. Return `null` to skip the cache for that request.
   */
  key?: string | ((ctx: RequestContext) => string | null)
}

/** What a handler sent, enough to send it again. */
interface Recorded {
  status: number
  type?: string
  headers: Record<string, string | string[]>
  body: string
  /** `body` is base64 of bytes the handler sent. */
  binary?: boolean
}

interface Entry {
  recorded: Recorded
  storedAt: number
}

/** Requests that would otherwise each build the same response, by key. */
const inFlight = new Map<string, Promise<Recorded | null>>()

/** Headers that identify the caller: a request carrying one is never cached under a shared key. */
const PERSONAL = ['authorization', 'proxy-authorization', 'x-api-key', 'cookie']

export function CacheResponse(options: CacheResponseOptions): MethodDecorator {
  const maxAgeMs = options.maxAge * 1000
  const swrMs = (options.swr ?? 0) * 1000
  const varies = (options.varies ?? []).map((h) => h.toLowerCase())

  return (target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (ctx: RequestContext, ...rest: unknown[]) => unknown
    const owner = typeof target === 'function' ? target.name : target.constructor?.name
    const prefix =
      typeof options.key === 'string'
        ? options.key
        : `kick:response:${owner ?? 'anonymous'}.${String(propertyKey)}`
    const keyOf = typeof options.key === 'function' ? options.key : undefined

    descriptor.value = async function (this: unknown, ctx: RequestContext, ...rest: unknown[]) {
      const req = ctx.req as { method?: string; url?: string; originalUrl?: string }
      const method = String(req.method ?? 'GET').toUpperCase()
      const headers = ctx.headers as Record<string, string | string[] | undefined>
      if ((method !== 'GET' && method !== 'HEAD') || maxAgeMs + swrMs <= 0) {
        return original.call(this, ctx, ...rest)
      }
      let identity: string
      if (keyOf) {
        const chosen = keyOf(ctx)
        if (chosen === null) return original.call(this, ctx, ...rest)
        identity = chosen
      } else {
        const personal =
          PERSONAL.some((h) => headers[h] !== undefined && !varies.includes(h)) ||
          (ctx.user !== undefined && !varies.some((h) => PERSONAL.includes(h)))
        if (personal) return original.call(this, ctx, ...rest)
        // The exact host the handler sees: one app serving several hosts answers
        // each differently, and a handler may put the host in the body. A host
        // that isn't `name[:port]` is never cached — nothing ambiguous in the key.
        const host = String(headers.host ?? '')
        if (!VALID_HOST.test(host)) return original.call(this, ctx, ...rest)
        identity = JSON.stringify([host.toLowerCase(), req.originalUrl ?? req.url ?? ''])
      }
      const varied = varies.map((h) => `${h}=${String(headers[h] ?? '')}`).join('&')
      const key = `${prefix}:${identity}|${varied}`
      const provider = getCacheProvider()
      const build = () => buildOnce(key, () => record(original, this, ctx, rest))
      const store = async (recorded: Recorded | null) => {
        if (recorded && cacheable(recorded)) {
          const entry: Entry = { recorded, storedAt: Date.now() }
          await provider.set(key, entry, maxAgeMs + swrMs)
        }
        return recorded
      }

      const entry = (await provider.get(key)) as Entry | null
      if (entry) {
        const age = Date.now() - entry.storedAt
        if (age < maxAgeMs + swrMs) {
          // Stale: answer now, rebuild for the next request.
          if (age >= maxAgeMs) waitUntil(build().then(store))
          replay(ctx, entry.recorded)
          return undefined
        }
      }

      const recorded = await build().then(store)
      if (recorded) replay(ctx, recorded)
      return undefined
    }
    return descriptor
  }
}

/** `name[:port]` or `[ipv6][:port]` — no path, userinfo or whitespace. */
const VALID_HOST = /^(?:\[[0-9a-f:.]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::\d{1,5})?$/i

/** Concurrent misses on one key share a single build. */
function buildOnce(key: string, run: () => Promise<Recorded | null>): Promise<Recorded | null> {
  const pending = inFlight.get(key)
  if (pending) return pending
  const load = run().finally(() => inFlight.delete(key))
  inFlight.set(key, load)
  return load
}

/** Only a 200 that sets no cookie is shared. */
function cacheable(recorded: Recorded): boolean {
  return recorded.status === 200 && !('set-cookie' in recorded.headers)
}

/**
 * Run the handler against a context whose response is a recording. Null when
 * it sent nothing — the request then falls through as it would uncached.
 */
async function record(
  handler: (ctx: RequestContext, ...rest: unknown[]) => unknown,
  self: unknown,
  ctx: RequestContext,
  rest: unknown[],
): Promise<Recorded | null> {
  const recorded: Recorded = { status: 200, headers: {}, body: '' }
  let sent = false
  const finish = (body: unknown) => {
    if (body instanceof Uint8Array) {
      recorded.body = toBase64(body)
      recorded.binary = true
    } else if (typeof body === 'string') {
      recorded.body = body
    } else if (body !== undefined && body !== null) {
      recorded.type ??= 'application/json; charset=utf-8'
      recorded.body = stringifyJson(body)
    }
    sent = true
  }
  const unsupported = (what: string) => () => {
    throw new Error(
      `@CacheResponse: the handler called ${what}. A cached route answers with ` +
        'ctx.json / ctx.send / ctx.html or a returned value, not a stream or a template.',
    )
  }
  const response = {
    status(code: number) {
      recorded.status = code
      return response
    },
    type(contentType: string) {
      recorded.type = contentType
      return response
    },
    json(data: unknown) {
      recorded.type ??= 'application/json; charset=utf-8'
      recorded.body = stringifyJson(data)
      sent = true
      return response
    },
    send(data: unknown) {
      finish(data)
      return response
    },
    end(data?: unknown) {
      finish(data)
      return response
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      recorded.headers[name.toLowerCase()] = Array.isArray(value)
        ? [...(value as readonly string[])]
        : String(value)
    },
    get headersSent() {
      return sent
    },
    once() {},
    render: unsupported('render()'),
    writeHead: unsupported('writeHead()'),
    flushHeaders: unsupported('flushHeaders()'),
    write: unsupported('write()'),
  }
  // Everything but the response is the real request's: params, query, headers, metadata.
  const recordingCtx = Object.create(ctx, {
    _response: { value: response as unknown as RuntimeResponse },
  }) as RequestContext
  const result = await handler.call(self, recordingCtx, ...rest)
  if (!sent) await applyHandlerResult(recordingCtx, result)
  return sent ? recorded : null
}

/** Send a recorded response — `304` when the client's copy is current. */
function replay(ctx: RequestContext, recorded: Recorded): void {
  for (const [name, value] of Object.entries(recorded.headers)) {
    if (name !== 'etag' && name !== 'content-type') ctx.setHeader(name, value)
  }
  if (recorded.status === 200) {
    const etag = (recorded.headers.etag as string | undefined) ?? weakEtag(recorded.body)
    if (ctx.conditional({ etag })) return
  }
  const options = { status: recorded.status, type: recorded.type ?? 'text/plain; charset=utf-8' }
  ctx.send(recorded.binary ? fromBase64(recorded.body) : recorded.body, options)
}

/** A weak ETag from the body — FNV-1a, enough to tell versions apart. */
function weakEtag(body: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `W/"${body.length.toString(16)}-${(hash >>> 0).toString(16)}"`
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
