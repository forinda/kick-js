/**
 * Host header parsing shared by the middleware that trusts it (CSRF origin
 * check, allowed hosts). One grammar and one canonical form, so two checks
 * never disagree about what host a request named.
 *
 * @module @forinda/kickjs/http/host
 */

/** An http(s) URL, or undefined for anything else (`null`, `file:`, garbage). */
export function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/**
 * RFC 9110 `Host`: a hostname or bracketed IPv6 literal, optional port. Checked
 * before parsing, so the URL parser never sees userinfo, a path or whitespace —
 * `x@a.test` would otherwise parse to the host `a.test`.
 */
export const HOST_GRAMMAR = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/

/**
 * The request's host, canonicalized the way `URL` canonicalizes the origin it
 * is compared with (case, IDN, default port for that scheme) — comparing two
 * strings parsed by different rules is how checks like this get bypassed.
 */
export function canonicalHost(host: string | undefined, protocol: string): string | undefined {
  if (!host || !HOST_GRAMMAR.test(host)) return undefined
  return parseHttpUrl(`${protocol}//${host}`)?.host
}
