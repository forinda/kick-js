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
 * counterpart of `timingSafeEqual`. A length mismatch returns early; the
 * length of a token is not the secret.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
