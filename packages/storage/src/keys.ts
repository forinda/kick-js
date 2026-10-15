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

export function toBytes(body: Uint8Array | string): Uint8Array {
  return typeof body === 'string' ? new TextEncoder().encode(body) : body
}
