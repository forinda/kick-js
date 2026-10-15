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

/** The smallest string after every string that starts with `s`. */
const pastPrefix = (s: string) =>
  s.slice(0, -1) + String.fromCharCode(s.charCodeAt(s.length - 1) + 1)

export interface ListRequest {
  prefix: string
  cursor?: string
  limit: number
  delimiter?: string
}

/**
 * One page of a listing, for drivers that walk their keys in order (memory,
 * disk). `keysFrom(from)` yields the keys under the prefix, in order, from
 * `from` (inclusive). With a delimiter, keys that have it after the prefix
 * collapse into one `prefixes` entry each — `a/b/` for `a/b/c` — and the walk
 * jumps past the whole group. Files and prefixes count toward `limit`
 * together, as on S3. The cursor is the last key or prefix returned.
 */
export async function listPage(
  keysFrom: (from: string | undefined) => AsyncIterable<string>,
  { prefix, cursor, limit, delimiter }: ListRequest,
): Promise<{ keys: string[]; prefixes: string[]; cursor?: string }> {
  const items: { name: string; group: boolean }[] = []
  // A cursor ending in the delimiter is a prefix: resume after all its keys.
  let from =
    cursor === undefined
      ? undefined
      : delimiter && cursor.endsWith(delimiter)
        ? pastPrefix(cursor)
        : `${cursor}\0`
  walk: for (;;) {
    for await (const key of keysFrom(from)) {
      const cut = delimiter ? key.indexOf(delimiter, prefix.length) : -1
      if (cut < 0) {
        items.push({ name: key, group: false })
        if (items.length > limit) break walk
        continue
      }
      const group = key.slice(0, cut + delimiter!.length)
      items.push({ name: group, group: true })
      if (items.length > limit) break walk
      from = pastPrefix(group)
      continue walk
    }
    break
  }
  const page = items.slice(0, limit)
  return {
    keys: page.filter((item) => !item.group).map((item) => item.name),
    prefixes: page.filter((item) => item.group).map((item) => item.name),
    ...(items.length > limit ? { cursor: page.at(-1)!.name } : {}),
  }
}

export function checkDelimiter(delimiter: string | undefined) {
  if (delimiter !== undefined && (typeof delimiter !== 'string' || delimiter === '')) {
    throw new Error('storage: list() delimiter must be a non-empty string')
  }
  return delimiter
}
