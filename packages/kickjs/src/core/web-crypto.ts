/**
 * Web Crypto helpers — portable across node/bun/deno/workers via
 * `globalThis.crypto`. The Web Crypto migration lives here so the request
 * path never imports `node:crypto` (edge-runtime portability).
 */

/** Random hex string — replacement for `randomBytes(n).toString('hex')`. */
export function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Constant-time string comparison for secrets and tokens — the portable
 * counterpart of `timingSafeEqual`. Walks the longer input and folds the
 * length difference in, so neither the contents nor the length of the
 * expected value shows in the timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  // Past the end, charCodeAt is NaN, which `^` treats as 0.
  for (let i = 0; i < length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Constant-time check of an `Authorization: Bearer <secret>` header against a
 * shared secret — a cron trigger, a metrics scrape, a webhook. `false` for a
 * missing or non-string header, and for an empty secret (an unset env var
 * must not let `Authorization: Bearer ` through). Pass
 * `ctx.headers.authorization` as is.
 */
export function matchesBearer(header: unknown, secret: string): boolean {
  return (
    typeof header === 'string' &&
    typeof secret === 'string' &&
    secret.length > 0 &&
    safeEqual(header, `Bearer ${secret}`)
  )
}
