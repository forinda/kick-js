import type { Request, Response, NextFunction } from 'express'

export interface BreachPaddingOptions {
  /**
   * Padding added to each compressed response is 0 to `maxBytes - 1` bytes,
   * drawn fresh every time. Default 100, as Django's `GZipMiddleware`.
   */
  maxBytes?: number
}

const GZIP_HEADER = 10
const FNAME = 0x08

/** A random `0 … max-1`, from Web Crypto. */
function randomBelow(max: number): number {
  if (max <= 1) return 0
  const [value] = crypto.getRandomValues(new Uint32Array(1))
  return value % max
}

/**
 * Pad a complete gzip member's header with a random-length file name (the
 * gzip `FNAME` field, which decompressors ignore). Returns `chunk` unchanged
 * unless it starts with a plain gzip header — magic, deflate, no flags set —
 * so anything else (plaintext, another encoding, a header already carrying
 * fields) passes through untouched.
 */
export function padGzipHeader(chunk: Uint8Array, maxBytes: number): Uint8Array {
  if (
    chunk.length < GZIP_HEADER ||
    chunk[0] !== 0x1f ||
    chunk[1] !== 0x8b ||
    chunk[2] !== 0x08 ||
    chunk[3] !== 0
  ) {
    return chunk
  }
  const length = randomBelow(maxBytes)
  const padded = new Uint8Array(chunk.length + length + 1)
  padded.set(chunk.subarray(0, GZIP_HEADER))
  padded[3] = FNAME
  padded.fill(0x61, GZIP_HEADER, GZIP_HEADER + length) // 'a' × length
  padded[GZIP_HEADER + length] = 0 // name terminator
  padded.set(chunk.subarray(GZIP_HEADER), GZIP_HEADER + length + 1)
  return padded
}

type Writer = (chunk?: unknown, ...rest: unknown[]) => unknown

/**
 * BREACH mitigation for `compression()`: makes the size of every gzip response
 * vary by a random amount, so an attacker watching encrypted traffic cannot
 * learn a secret in the page from how well their guesses compress (Django's
 * "Heal The Breach"). Opt-in — it costs some compression ratio.
 *
 * Mount it **before** `compression()`, so it sees the compressed bytes:
 *
 * ```ts
 * bootstrap({ middlewares: [breachPadding(), compression(), …] })
 * ```
 *
 * Padding lives in the gzip header, which Brotli does not have, so this also
 * removes `br` and `zstd` from the request's `Accept-Encoding` — browsers then
 * get gzip, and the padding applies. Not for the web entry: Netlify, Vercel
 * and Cloudflare compress at the edge.
 */
export function breachPadding(options: BreachPaddingOptions = {}) {
  const maxBytes = options.maxBytes ?? 100

  return (req: Request, res: Response, next: NextFunction) => {
    const accept = req.headers['accept-encoding']
    if (typeof accept === 'string') {
      req.headers['accept-encoding'] = accept
        .split(',')
        .filter((part) => !/^\s*(br|zstd)\s*(;|$)/i.test(part))
        .join(',')
    }

    // compression() captures res.write / res.end when it runs, after this, so
    // its compressed output comes through these. The gzip header is in the
    // first bytes; collect until there are enough of them, pad, then pass the
    // rest through as it comes.
    const write = res.write.bind(res) as Writer
    const end = res.end.bind(res) as Writer
    let pending: Uint8Array | null = new Uint8Array(0)

    const isGzip = () => /\bgzip\b/i.test(String(res.getHeader('content-encoding') ?? ''))
    const take = (chunk: unknown): Uint8Array | null => {
      if (pending === null) return null
      if (!isGzip() || !(chunk instanceof Uint8Array)) {
        pending = null
        return null
      }
      const joined = new Uint8Array(pending.length + chunk.length)
      joined.set(pending)
      joined.set(chunk, pending.length)
      if (joined.length < GZIP_HEADER) {
        pending = joined
        return new Uint8Array(0)
      }
      pending = null
      return padGzipHeader(joined, maxBytes)
    }

    ;(res as unknown as { write: Writer }).write = (chunk, ...rest) => {
      const out = take(chunk)
      if (out === null) return write(chunk, ...rest)
      return out.length > 0 ? write(Buffer.from(out), ...rest) : true
    }
    ;(res as unknown as { end: Writer }).end = (chunk, ...rest) => {
      if (typeof chunk === 'function') return end(chunk, ...rest)
      const flushed = pending && pending.length > 0 && chunk === undefined ? pending : null
      const out = chunk === undefined ? flushed : take(chunk)
      pending = null
      if (out === null) return end(chunk, ...rest)
      return end(Buffer.from(out), ...rest)
    }
    next()
  }
}
