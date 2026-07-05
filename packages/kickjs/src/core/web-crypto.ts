/**
 * Web Crypto helpers — portable across node/bun/deno/workers via
 * `globalThis.crypto`. The Web Crypto migration lives here so the request
 * path never imports `node:crypto` (edge-runtime portability, see
 * `web-standards-edge-design.md` P0).
 */

/** Random hex string — replacement for `randomBytes(n).toString('hex')`. */
export function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}
