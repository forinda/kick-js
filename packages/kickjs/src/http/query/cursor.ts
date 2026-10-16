import { HttpException } from '../../core/errors'
import type { CursorPosition, CursorValue, SortItem } from './types'

/**
 * Cursor wire format: base64url JSON `{ v: <position>, s: <sort signature> }`.
 * Unsigned by design — the position is only ever handed to the fetcher as
 * data, and the sort signature makes a cursor from one ordering answer 400
 * under another instead of silently skipping or repeating rows.
 */

/** `createdAt:desc,id:asc` — what a cursor was issued under. */
export function sortSignature(sort: readonly SortItem[]): string {
  return sort.map((s) => `${s.field}:${s.direction}`).join(',')
}

function isPrimitive(value: unknown): value is CursorValue {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

export function encodeCursor(position: Record<string, CursorValue>, signature: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: position, s: signature }))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Decode a client cursor. Anything that is not exactly what
 * {@link encodeCursor} produces for this sort (and, when `keys` is given,
 * for exactly these fields) is a 400 — never a guess.
 */
export function decodeCursor(
  raw: unknown,
  signature: string,
  keys: readonly string[] | undefined,
): CursorPosition {
  const invalid = () => HttpException.badRequest('Invalid pagination cursor')
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]+$/.test(raw)) throw invalid()
  let parsed: unknown
  try {
    const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw invalid()
  }
  if (typeof parsed !== 'object' || parsed === null) throw invalid()
  const { v, s } = parsed as { v?: unknown; s?: unknown }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw invalid()
  if (!Object.values(v).every(isPrimitive)) throw invalid()
  if (keys) {
    const got = Object.keys(v)
    if (got.length !== keys.length || !keys.every((k) => Object.hasOwn(v, k))) throw invalid()
  }
  if (s !== signature) {
    throw HttpException.badRequest('Pagination cursor was issued for a different sort')
  }
  return v as CursorPosition
}

/**
 * The current request's path + query with `key` replaced (or dropped when
 * `value` is null). Relative on purpose: the host comes from the client, so
 * it never goes into a link. The path is re-derived through `URL`, so an
 * absolute-form request target (`GET http://evil/...`), a `//host` path, or
 * a doubled leading slash cannot turn the link into an off-site URL. Other params keep their
 * original encoding.
 */
export function pageLink(rawUrl: string, key: string, value: string | number | null): string {
  const url = parseUrl(rawUrl)
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((part) => part !== '' && paramName(part) !== key)
  if (value !== null) kept.push(`${key}=${encodeURIComponent(value)}`)
  return kept.length ? `${url.pathname}?${kept.join('&')}` : url.pathname
}

/** The current request's path + query, relative — see {@link pageLink}. */
export function selfLink(rawUrl: string): string {
  const url = parseUrl(rawUrl)
  return url.pathname + url.search
}

/** Host-less parse; a leading `//` in the path would read as a host in a link, so collapse it. */
function parseUrl(rawUrl: string): URL {
  const url = new URL(rawUrl, 'http://localhost')
  url.pathname = url.pathname.replace(/^\/+/, '/')
  return url
}

function paramName(part: string): string {
  const name = part.split('=', 1)[0].replace(/\+/g, ' ')
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}
