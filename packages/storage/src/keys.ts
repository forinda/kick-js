/**
 * Keys are `/`-separated paths like `avatars/42.png`. Refused: empty,
 * a leading `/`, empty / `.` / `..` segments, `\` and NUL — so a key built
 * from user input can't climb out of the disk root or address another object.
 */
export function checkKey(key: string): string {
  if (
    typeof key !== 'string' ||
    key === '' ||
    key.includes('\\') ||
    key.includes('\0') ||
    key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`storage: invalid key '${String(key)}'`)
  }
  return key
}

/** RFC 3986 encoding — `encodeURIComponent` leaves `!'()*` alone. */
export function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** A key as a URL path: each segment encoded, the slashes kept. */
export function encodeKey(key: string): string {
  return checkKey(key).split('/').map(encodeSegment).join('/')
}

/** What `put()` takes: bytes, text, or a stream (a web `ReadableStream`, a Node `Readable`). */
export type Body = Uint8Array | string | AsyncIterable<Uint8Array>

export function toBytes(body: Uint8Array | string): Uint8Array {
  return typeof body === 'string' ? new TextEncoder().encode(body) : body
}

export function isStream(body: Body): body is AsyncIterable<Uint8Array> {
  return typeof body !== 'string' && !(body instanceof Uint8Array)
}

/** A whole body as bytes. */
export async function collect(body: Body): Promise<Uint8Array> {
  if (!isStream(body)) return toBytes(body)
  const chunks: Uint8Array[] = []
  for await (const chunk of body) chunks.push(typeof chunk === 'string' ? toBytes(chunk) : chunk)
  return concatBytes(chunks)
}

/** `Buffer.concat` without `Buffer`, which edge runtimes may not have. */
export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

export function publicUrl(driver: string, baseUrl: string | undefined, key: string) {
  if (baseUrl === undefined) {
    throw new Error(`${driver}: url() needs the \`baseUrl\` the files are served from`)
  }
  return `${baseUrl.replace(/\/+$/, '')}/${encodeKey(key)}`
}

export function checkLimit(limit = 1000): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('storage: list() limit must be a whole number from 1 to 1000')
  }
  return limit
}

/**
 * One page of sorted `keys` under `prefix`, after `cursor` — for drivers that
 * hold every key (memory, disk). The cursor is the last key returned.
 */
export function pageOf(
  keys: Iterable<string>,
  prefix: string,
  cursor: string | undefined,
  limit: number,
): { keys: string[]; cursor?: string } {
  const matching = [...keys]
    .filter((key) => key.startsWith(prefix) && (cursor === undefined || key > cursor))
    .toSorted()
  const page = matching.slice(0, limit)
  return matching.length > limit ? { keys: page, cursor: page.at(-1) } : { keys: page }
}
