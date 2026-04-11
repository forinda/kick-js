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

/**
 * POST a JSON payload to a URL and parse the JSON response. Throws a
 * `ProviderError` on non-2xx status codes so the caller never has to
 * check `res.ok` itself.
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
  } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new ProviderError(res.status, text)
  }

  return (await res.json()) as T
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
  } = {},
): AsyncGenerator<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...options.headers,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!res.ok) {
    const text = await res.text()
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
