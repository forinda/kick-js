/**
 * Conditional requests (RFC 9110 §13): answer `304 Not Modified` when the
 * client's copy is current, and `412 Precondition Failed` when a write was
 * based on a stale one. Decided from validators the handler supplies — an
 * ETag, a last-modified time — before it does the expensive part.
 *
 * @module @forinda/kickjs/http/conditional
 */

/** What identifies the current version of a resource. */
export interface Validators {
  /**
   * An entity tag. Quoted for you if bare: `'v42'` → `"v42"`. Prefix with
   * `W/` for a weak tag (same meaning, not byte-identical).
   */
  etag?: string
  /** When the resource last changed. Compared to the second, as HTTP dates are. */
  lastModified?: Date
}

/** 200: go on and respond. 304 / 412: answer with that status, no body. */
export type ConditionalOutcome = 200 | 304 | 412

type Headers = Record<string, string | string[] | undefined>

function header(headers: Headers, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value.join(', ') : value
}

/** `"v1"` and `W/"v1"` stay; bare `v1` becomes `"v1"`, bare `W/v1` becomes `W/"v1"`. */
export function normalizeEtag(etag: string): string {
  if (/^(W\/)?".*"$/.test(etag)) return etag
  // Keep a weak prefix weak: quoting `W/v1` whole would make `"W/v1"`, a
  // strong tag, and change how If-Match compares it.
  const weak = etag.startsWith('W/')
  const bare = (weak ? etag.slice(2) : etag).replaceAll('"', '')
  return `${weak ? 'W/' : ''}"${bare}"`
}

const opaque = (tag: string) => tag.replace(/^W\//, '')
const isWeak = (tag: string) => tag.startsWith('W/')

/** The tags in an If-Match / If-None-Match list (`*` kept as is). */
function tagsOf(value: string): string[] {
  return value.match(/\*|(?:W\/)?"[^"]*"/g) ?? []
}

/** An HTTP date, or undefined when it doesn't parse — an invalid one is ignored. */
function dateOf(value: string | undefined): number | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}

/** HTTP dates have one-second resolution. */
const seconds = (date: Date) => Math.floor(date.getTime() / 1000) * 1000

/**
 * The outcome of a request's preconditions against the current validators,
 * evaluated in RFC 9110 §13.2.2 order.
 */
export function evaluatePreconditions(
  method: string,
  headers: Headers,
  validators: Validators,
): ConditionalOutcome {
  const etag = validators.etag === undefined ? undefined : normalizeEtag(validators.etag)
  const modified = validators.lastModified ? seconds(validators.lastModified) : undefined
  const safe = method === 'GET' || method === 'HEAD'

  // 1. If-Match — strong comparison; `*` matches any current representation.
  const ifMatch = header(headers, 'if-match')
  if (ifMatch !== undefined) {
    const tags = tagsOf(ifMatch)
    const matched =
      tags.includes('*') ||
      (etag !== undefined && !isWeak(etag) && tags.some((t) => !isWeak(t) && t === etag))
    if (!matched) return 412
  } else {
    // 2. If-Unmodified-Since, only without If-Match.
    const since = dateOf(header(headers, 'if-unmodified-since'))
    if (since !== undefined && modified !== undefined && modified > since) return 412
  }

  // 3. If-None-Match — weak comparison.
  const ifNoneMatch = header(headers, 'if-none-match')
  if (ifNoneMatch !== undefined) {
    const tags = tagsOf(ifNoneMatch)
    const matched =
      tags.includes('*') || (etag !== undefined && tags.some((t) => opaque(t) === opaque(etag)))
    if (matched) return safe ? 304 : 412
    return 200
  }

  // 4. If-Modified-Since, only for GET/HEAD and only without If-None-Match.
  if (safe) {
    const since = dateOf(header(headers, 'if-modified-since'))
    if (since !== undefined && modified !== undefined && modified <= since) return 304
  }
  return 200
}
