/**
 * Provider-side helpers shared by every built-in `AiProvider`
 * implementation.
 *
 * Each provider in `packages/ai/src/providers/` implements the
 * `AiProvider` interface from `../types`. This file holds the bits
 * that all of them need: HTTP error mapping, JSON parsing, SSE line
 * splitting for streaming responses. Keeping these here means each
 * provider's main file stays focused on the wire-format translation
 * specific to its vendor.
 */

/**
 * Error thrown by built-in providers when the upstream API returns a
 * non-2xx status. Carries the HTTP status, the raw response body, and
 * a parsed error object when available, so callers can branch on
 * specific failure modes (auth, rate limit, content filter, etc.).
 */
export class ProviderError extends Error {
  readonly status: number
  readonly body: string
  readonly parsedBody?: unknown

  constructor(status: number, body: string, message?: string) {
    super(message ?? `Provider request failed with status ${status}`)
    this.name = 'ProviderError'
    this.status = status
    this.body = body
    try {
      this.parsedBody = JSON.parse(body)
    } catch {
      // Body wasn't JSON; leave parsedBody undefined
    }
  }
}

/** Status codes that indicate a transient failure worth retrying. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

/** Default retry configuration. */
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BASE_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 30_000

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3). Set to 0 to disable retries. */
  maxRetries?: number
  /** Base delay in ms before first retry (default: 1000). Doubles each attempt. */
  baseDelayMs?: number
  /** Maximum delay cap in ms (default: 30000). */
  maxDelayMs?: number
}

/**
 * Sleep for `ms` milliseconds, respecting an optional AbortSignal.
 * Resolves to `false` if aborted, `true` if the delay completed.
 */
function delay(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false)
    const timer = setTimeout(() => resolve(true), ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

/**
 * Calculate retry delay with exponential backoff + jitter.
 * Jitter prevents thundering herd when multiple clients retry simultaneously.
 */
function retryDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * 2 ** attempt
  const jitter = exponential * (0.5 + Math.random() * 0.5)
  return Math.min(jitter, maxMs)
}

/**
 * POST a JSON payload to a URL and parse the JSON response. Throws a
 * `ProviderError` on non-2xx status codes so the caller never has to
 * check `res.ok` itself.
 *
 * Retries transient failures (429, 500, 502, 503, 504) with exponential
 * backoff and jitter. Honors `Retry-After` headers from rate-limited responses.
 *
 * Auth headers are the caller's responsibility. Different providers
 * use different conventions — OpenAI uses `Authorization: Bearer ...`,
 * Anthropic uses `x-api-key: ...`, Google uses `?key=...` in the URL —
 * so this helper stays neutral and lets each provider build exactly
 * the headers it needs.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  options: {
    headers?: Record<string, string>
    signal?: AbortSignal
    retry?: RetryOptions
  } = {},
): Promise<T> {
  const maxRetries = options.retry?.maxRetries ?? DEFAULT_MAX_RETRIES
  const baseDelayMs = options.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.retry?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    })

    if (res.ok) {
      return (await res.json()) as T
    }

    const text = await res.text()

    // Retry on transient failures
    if (attempt < maxRetries && RETRYABLE_STATUSES.has(res.status)) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
      const waitMs = retryAfter ?? retryDelay(attempt, baseDelayMs, maxDelayMs)
      const ok = await delay(waitMs, options.signal)
      if (!ok) throw new ProviderError(res.status, text) // Aborted
      continue
    }

    throw new ProviderError(res.status, text)
  }
}

/**
 * Parse the `Retry-After` header value into milliseconds.
 * Supports both seconds (integer) and HTTP-date formats.
 * Returns null if the header is missing or unparseable.
 */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (!Number.isNaN(seconds)) return seconds * 1000
  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return null
}

/**
 * POST a JSON payload and stream the response body as a sequence of
 * SSE-style `data: ...` events. Each yielded value is the raw payload
 * after the `data: ` prefix is stripped — provider code is responsible
 * for parsing it as JSON (or detecting the `[DONE]` sentinel that
 * OpenAI uses to signal end-of-stream).
 *
 * Implementation notes:
 *  - Uses the global `fetch` ReadableStream so it works in Node 20+
 *    without depending on `node-fetch` or `eventsource-parser`.
 *  - Buffers partial lines across chunk boundaries; an SSE event can
 *    arrive split across two TCP packets.
 *  - Skips empty lines and lines that don't start with `data: ` per
 *    the SSE spec.
 *  - Aborts cleanly via the optional AbortSignal — the caller's
 *    `for await` loop will throw `AbortError` if the signal fires.
 */
export async function* postJsonStream(
  url: string,
  body: unknown,
  options: {
    headers?: Record<string, string>
    signal?: AbortSignal
    retry?: RetryOptions
  } = {},
): AsyncGenerator<string> {
  const maxRetries = options.retry?.maxRetries ?? DEFAULT_MAX_RETRIES
  const baseDelayMs = options.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.retry?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS

  let res: Response | undefined
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...options.headers,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    })

    if (res.ok) break

    const text = await res.text()

    if (attempt < maxRetries && RETRYABLE_STATUSES.has(res.status)) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
      const waitMs = retryAfter ?? retryDelay(attempt, baseDelayMs, maxDelayMs)
      const ok = await delay(waitMs, options.signal)
      if (!ok) throw new ProviderError(res.status, text)
      continue
    }

    throw new ProviderError(res.status, text)
  }
  if (!res.body) {
    throw new ProviderError(res.status, '', 'Provider streaming response had no body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Process complete lines; keep any partial trailing line in the
      // buffer for the next iteration.
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        if (line.length === 0) continue
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload.length === 0) continue
        yield payload
      }
    }

    // Flush any final line that didn't end with a newline.
    const tail = buffer.trim()
    if (tail.startsWith('data:')) {
      const payload = tail.slice(5).trim()
      if (payload.length > 0) yield payload
    }
  } finally {
    // Defensive: release the reader so the underlying socket can be
    // closed even if the consumer broke out of its for-await loop early.
    try {
      reader.releaseLock()
    } catch {
      // Reader might already be released; ignore.
    }
  }
}
