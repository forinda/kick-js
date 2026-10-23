/**
 * The built-in pipes (spec §7). Synchronous, locale- and time-zone-aware
 * through the render's env — never the server's.
 */
import type { Pipe } from '../render/render'
import { SafeHtml } from '../render/safe'

export const BUILTIN_PIPES: readonly string[] = [
  'uppercase',
  'lowercase',
  'titlecase',
  'json',
  'slice',
  'keys',
  'entries',
  'url',
  'raw',
  'date',
  'number',
  'currency',
  'percent',
  'kvRoute',
  'kvQuery',
]

export interface PipeEnv {
  locale: string
  timeZone: string
  /** The request's `ctx.urlFor` (params in path order), for `kvRoute`. Absent outside a request. */
  urlFor?: (name: string, params: Array<string | number>) => string
}

const DATE_FORMATS: Record<string, Intl.DateTimeFormatOptions> = {
  short: { dateStyle: 'short', timeStyle: 'short' },
  medium: { dateStyle: 'medium', timeStyle: 'medium' },
  long: { dateStyle: 'long', timeStyle: 'long' },
  full: { dateStyle: 'full', timeStyle: 'long' },
  shortDate: { dateStyle: 'short' },
  mediumDate: { dateStyle: 'medium' },
  longDate: { dateStyle: 'long' },
  fullDate: { dateStyle: 'full' },
  shortTime: { timeStyle: 'short' },
  mediumTime: { timeStyle: 'medium' },
}

/** Digits as `minInt.minFrac-maxFrac`, e.g. `1.0-2`. */
function digits(info: unknown): Intl.NumberFormatOptions {
  if (info === undefined || info === null) return {}
  const m = /^(\d+)\.(\d+)-(\d+)$/.exec(String(info))
  if (!m) throw new Error(`digits must look like '1.0-2', got '${String(info)}'`)
  return {
    minimumIntegerDigits: Number(m[1]),
    minimumFractionDigits: Number(m[2]),
    maximumFractionDigits: Number(m[3]),
  }
}

/**
 * Intl formatters are costly to build: one per locale and options, reused.
 * Locales and pipe arguments can come from a request or data, so the cache
 * is capped — past the limit it starts over rather than growing.
 */
export const FORMATTER_CACHE_LIMIT = 256
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()
export const formatterCacheSize = (): number => formatters.size
function remember<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, f: T): T {
  if (formatters.size >= FORMATTER_CACHE_LIMIT) formatters.clear()
  formatters.set(key, f)
  return f
}
/** The formatter cached under `key`, built by `make` on a miss. Keys are cheap strings, not serialised options. */
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, make: () => T): T {
  return (formatters.get(key) as T | undefined) ?? remember(key, make())
}

const toNumber = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

export function builtinPipes(env: PipeEnv): Record<string, Pipe> {
  return {
    // `{{ 'Users.show' | kvRoute:user.id }}`: the route's URL, params in path order.
    // `{{ url | kvQuery:'page':page:'sort':'name' }}`: key/value pairs onto a URL's
    // query. Empty values are skipped, so optional filters pass straight through.
    kvQuery: (url, ...pairs) => {
      if (pairs.length % 2) throw new Error("kvQuery takes key/value pairs: kvQuery:'page':page")
      const parts: string[] = []
      for (let i = 0; i < pairs.length; i += 2) {
        const key = encodeURIComponent(str(pairs[i]))
        for (const v of Array.isArray(pairs[i + 1]) ? (pairs[i + 1] as unknown[]) : [pairs[i + 1]])
          if (v !== undefined && v !== null && v !== '')
            parts.push(`${key}=${encodeURIComponent(str(v))}`)
      }
      const [base, hash] = str(url).split(/(?=#)/, 2) as [string, string?]
      if (!parts.length) return str(url)
      return `${base}${base.includes('?') ? '&' : '?'}${parts.join('&')}${hash ?? ''}`
    },
    // `kv`, for KickJS views: `route` stays free for an app's own pipe.
    kvRoute: (name, ...params) => {
      if (!env.urlFor)
        throw new Error(
          'kvRoute needs a request (ctx.render): outside one, pass the URLs in as data, built with ROUTE_URLS',
        )
      return env.urlFor(
        str(name),
        params.map((p) => (typeof p === 'number' ? p : str(p))),
      )
    },
    uppercase: (v) => str(v).toUpperCase(),
    lowercase: (v) => str(v).toLowerCase(),
    titlecase: (v) => str(v).replace(/\b\p{L}/gu, (c) => c.toUpperCase()),
    json: (v) => JSON.stringify(v, null, 2),
    slice: (v, start, end) =>
      typeof v === 'string' || Array.isArray(v)
        ? v.slice(start as number | undefined, end as number | undefined)
        : v,
    keys: (v) =>
      v instanceof Map ? [...v.keys()] : v && typeof v === 'object' ? Object.keys(v) : [],
    entries: (v) =>
      v instanceof Map ? [...v.entries()] : v && typeof v === 'object' ? Object.entries(v) : [],
    url: (v) => encodeURIComponent(str(v)),
    raw: (v) => (v instanceof SafeHtml ? v : new SafeHtml(str(v))),
    date: (v, format = 'medium', timeZone) => {
      if (v === null || v === undefined || v === '') return ''
      const d = v instanceof Date ? v : new Date(v as string | number)
      if (Number.isNaN(d.getTime())) return ''
      const preset = DATE_FORMATS[String(format)]
      if (!preset) throw new Error(`unknown date format '${String(format)}'`)
      const tz = (timeZone as string | undefined) ?? env.timeZone
      return cached(
        `d|${env.locale}|${String(format)}|${tz}`,
        () => new Intl.DateTimeFormat(env.locale, { ...preset, timeZone: tz }),
      ).format(d)
    },
    number: (v, info) => {
      const n = toNumber(v)
      if (n === undefined) return ''
      return cached(
        `n|${env.locale}|${String(info)}`,
        () => new Intl.NumberFormat(env.locale, digits(info)),
      ).format(n)
    },
    currency: (v, code, info) => {
      const n = toNumber(v)
      if (n === undefined) return ''
      return cached(
        `c|${env.locale}|${String(code)}|${String(info)}`,
        () =>
          new Intl.NumberFormat(env.locale, {
            style: 'currency',
            currency: String(code ?? 'USD'),
            ...digits(info),
          }),
      ).format(n)
    },
    percent: (v, info) => {
      const n = toNumber(v)
      if (n === undefined) return ''
      return cached(
        `p|${env.locale}|${String(info)}`,
        () => new Intl.NumberFormat(env.locale, { style: 'percent', ...digits(info) }),
      ).format(n)
    },
  }
}
