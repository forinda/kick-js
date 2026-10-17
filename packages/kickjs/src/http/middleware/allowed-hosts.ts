import type {
  ConnectRequest as Request,
  ConnectResponse as Response,
  ConnectNext as NextFunction,
} from '../connect'
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
   * proxy that sets it — a client can send the header too. Every value in it
   * must be allowed: a proxy that appends leaves the client's own value first,
   * and that first value is what Express's `req.hostname` reads.
   *
   * Without this option the header is removed from the request, so nothing
   * downstream (Express under `trust proxy`, your own code) reads a host this
   * check never saw. Default `false`.
   */
  trustForwardedHost?: boolean
  /**
   * Exact paths answered whatever the host, for `GET` and `HEAD` only — e.g.
   * probes that a platform sends to the instance's IP.
   * `bootstrap({ security: { allowedHosts } })` adds `/health/live` and
   * `/health/ready`.
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
    // Check every host a consumer could read, not one chosen by a rule that a
    // consumer may not share — which value of a list wins differs between
    // proxies and frameworks.
    const forwardedHeader = headerOf(headers, 'x-forwarded-host')
    let candidates: Array<string | undefined>
    if (trustForwardedHost && forwardedHeader !== undefined) {
      candidates = forwardedHeader.split(',').map((h) => h.trim())
    } else {
      // Not trusted: drop it, so it can't be read past this point.
      if (forwardedHeader !== undefined) delete headers['x-forwarded-host']
      candidates = [headerOf(headers, 'host') ?? headerOf(headers, ':authority')]
    }
    const passes = candidates.every((host) => {
      const hostname = hostnameOf(host)
      return hostname !== undefined && allowed(hostname)
    })
    if (passes) return next()
    // Probes read; nothing that changes state is exempt.
    const method = req.method?.toUpperCase()
    if (
      ignored.size > 0 &&
      (method === 'GET' || method === 'HEAD') &&
      ignored.has(resolvePathname(req as ClientRequestLike))
    ) {
      return next()
    }

    res.setHeader('content-type', 'application/problem+json')
    sendJson(res, 400, REJECTED)
  }
}
