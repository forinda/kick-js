import type { Request, Response, NextFunction } from 'express'
import { HOST_GRAMMAR, parseHttpUrl } from '../host'
import { resolvePathname, type ClientRequestLike } from '../client-ip'
import { sendJson } from './respond'

export interface AllowedHostsOptions {
  /**
   * Hosts this app answers for. `'example.com'` matches exactly;
   * `'.example.com'` matches it and every subdomain; `'*'` matches anything
   * (turns the check off). Ports are ignored. Compared case-insensitively,
   * internationalized names in either form.
   */
  hosts: string[]
  /**
   * Read the host from `X-Forwarded-Host` instead of `Host`. Only behind a
   * proxy that sets it — a client can send the header too. Default `false`.
   */
  trustForwardedHost?: boolean
  /**
   * Exact paths answered whatever the host — e.g. probes that a platform
   * sends to the instance's IP. `bootstrap({ security: { allowedHosts } })`
   * adds `/health/live` and `/health/ready`.
   */
  ignorePaths?: string[]
}

type HeaderBag = Record<string, string | string[] | undefined>

function headerOf(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** The hostname a `Host`-shaped value names, canonical, or undefined if malformed. */
function hostnameOf(host: string | undefined): string | undefined {
  if (!host || !HOST_GRAMMAR.test(host)) return undefined
  return parseHttpUrl(`http://${host}`)?.hostname
}

function compile(patterns: string[]): (hostname: string) => boolean {
  if (patterns.length === 0) throw new Error('allowedHosts(): list at least one host')
  if (patterns.includes('*')) return () => true
  const exact = new Set<string>()
  const suffixes: string[] = []
  for (const pattern of patterns) {
    const wildcard = pattern.startsWith('.')
    const hostname = hostnameOf(wildcard ? pattern.slice(1) : pattern)
    if (!hostname) {
      throw new Error(`allowedHosts(): '${pattern}' is not a host name`)
    }
    if (wildcard) suffixes.push(hostname)
    else exact.add(hostname)
  }
  return (hostname) =>
    exact.has(hostname) || suffixes.some((s) => hostname === s || hostname.endsWith(`.${s}`))
}

const REJECTED = {
  type: 'about:blank',
  title: 'Bad Request',
  status: 400,
  // The host itself is not echoed: it is attacker-chosen text.
  detail: 'This host is not served here.',
}

/**
 * Refuse requests whose `Host` is not one this app serves.
 *
 * Code that builds absolute URLs from the request — password-reset and
 * verification links, redirects, `Location` headers — trusts `Host`, and a
 * client chooses it. Without a check, a reset email can carry a link to the
 * attacker's domain, and a shared cache can store a response built for it.
 *
 * ```ts
 * bootstrap({ security: { allowedHosts: ['example.com', '.example.com'] } })
 * ```
 */
export function allowedHosts(options: string[] | AllowedHostsOptions) {
  const {
    hosts,
    trustForwardedHost = false,
    ignorePaths = [],
  } = Array.isArray(options) ? { hosts: options } : options
  const allowed = compile(hosts)
  const ignored = new Set(ignorePaths)

  return (req: Request, res: Response, next: NextFunction) => {
    const headers = req.headers as HeaderBag
    const forwarded = trustForwardedHost
      ? headerOf(headers, 'x-forwarded-host')?.split(',')[0]?.trim()
      : undefined
    const hostname = hostnameOf(
      forwarded ?? headerOf(headers, 'host') ?? headerOf(headers, ':authority'),
    )
    if (hostname !== undefined && allowed(hostname)) return next()
    if (ignored.size > 0 && ignored.has(resolvePathname(req as ClientRequestLike))) return next()

    res.setHeader('content-type', 'application/problem+json')
    sendJson(res, 400, REJECTED)
  }
}
