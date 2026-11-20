/**
 * The built-in pipes. Synchronous, locale- and time-zone-aware
 * through the render's env — never the server's.
 */
import type { Pipe } from '../render/render'
import { SafeHtml } from '../render/safe'

/** The names of the built-in pipes. */
export const BUILTIN_PIPES: readonly string[] = [
  'uppercase',
  'lowercase',
  'titlecase',
  'json',
  'slice',
  'join',
  'compact',
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

/**
 * Built-ins added later: an app pipe of the same name wins, so apps that
 * already had their own `ago` or `truncate` keep it.
 */
export const OVERRIDABLE_PIPES: readonly string[] = [
  'truncate',
  'default',
  'nl2br',
  'striptags',
  'first',
  'last',
  'length',
  'sort',
  'groupBy',
  'sum',
  'plural',
  'ago',
  'filesize',
  't',
]

/** What built-in pipes read from the render: locale, time zone, and the request's `urlFor`. */
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

/** A list pipe's input as an array: arrays and Sets as is, anything else empty. */
const list = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : v instanceof Set ? [...v] : typeof v === 'string' ? [...v] : []

/** `item[key]`, or the item itself without a key. */
const pick = (item: unknown, key: unknown): unknown =>
  key === undefined || key === null ? item : (item as Record<string, unknown> | null)?.[str(key)]

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Units for `ago`, largest first, in seconds. */
const AGO_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
]
const SIZE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte']

/**
 * The built-in pipes bound to a render's locale and time zone (`date`, `currency`, `kvRoute`, ...).
 *
 * @see https://kickjs.app/guide/views/pipes
 */
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
      const s = str(url)
      if (!parts.length) return s
      // The fragment is everything from the first `#` (it may hold more).
      const at = s.indexOf('#')
      const [base, hash] = at < 0 ? [s, ''] : [s.slice(0, at), s.slice(at)]
      return `${base}${base.includes('?') ? '&' : '?'}${parts.join('&')}${hash}`
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
    // ── overridable (OVERRIDABLE_PIPES) ──
    truncate: (v, n, suffix = '…') => {
      const chars = [...str(v)]
      const max = Number(n)
      return chars.length <= max ? chars.join('') : chars.slice(0, max).join('') + str(suffix)
    },
    default: (v, fallback) => (v === null || v === undefined || v === '' ? fallback : v),
    nl2br: (v) =>
      new SafeHtml(
        str(v)
          .replace(/[&<>"']/g, (c) => ESCAPES[c]!)
          .replace(/\r?\n/g, '<br>'),
      ),
    striptags: (v) => str(v).replace(/<[^>]*>/g, ''),
    first: (v) => list(v)[0],
    last: (v) => list(v).at(-1),
    length: (v) =>
      typeof v === 'string' || Array.isArray(v)
        ? v.length
        : v instanceof Set || v instanceof Map
          ? v.size
          : v && typeof v === 'object'
            ? Object.keys(v).length
            : 0,
    sort: (v, key) =>
      list(v).toSorted((a, b) => {
        const x = pick(a, key)
        const y = pick(b, key)
        return typeof x === 'number' && typeof y === 'number'
          ? x - y
          : str(x).localeCompare(str(y), env.locale)
      }),
    groupBy: (v, key) => {
      const groups = new Map<unknown, unknown[]>()
      for (const item of list(v)) {
        const g = pick(item, key)
        const at = groups.get(g)
        if (at) at.push(item)
        else groups.set(g, [item])
      }
      return [...groups]
    },
    sum: (v, key) => list(v).reduce<number>((t, item) => t + (toNumber(pick(item, key)) ?? 0), 0),
    plural: (v, one, other) => {
      const n = toNumber(v) ?? 0
      const form = new Intl.PluralRules(env.locale).select(n)
      const nf = cached(`n|${env.locale}|`, () => new Intl.NumberFormat(env.locale))
      return `${nf.format(n)} ${str(form === 'one' ? one : other)}`
    },
    ago: (v) => {
      if (v === null || v === undefined || v === '') return ''
      const at = v instanceof Date ? v : new Date(v as string | number)
      if (Number.isNaN(+at)) return ''
      const secs = (+at - Date.now()) / 1000
      const [unit, size] = AGO_UNITS.find(([, s]) => Math.abs(secs) >= s) ?? AGO_UNITS.at(-1)!
      return new Intl.RelativeTimeFormat(env.locale).format(Math.round(secs / size), unit)
    },
    filesize: (v) => {
      let n = toNumber(v) ?? 0
      let i = 0
      while (Math.abs(n) >= 1000 && i < SIZE_UNITS.length - 1) {
        n /= 1000
        i++
      }
      const unit = SIZE_UNITS[i]!
      return cached(
        `size|${env.locale}|${unit}`,
        () =>
          new Intl.NumberFormat(env.locale, {
            style: 'unit',
            unit,
            unitDisplay: 'short',
            maximumFractionDigits: 1,
          }),
      ).format(n)
    },
    // ── reserved (BUILTIN_PIPES) ──
    uppercase: (v) => str(v).toUpperCase(),
    lowercase: (v) => str(v).toLowerCase(),
    titlecase: (v) => str(v).replace(/\b\p{L}/gu, (c) => c.toUpperCase()),
    json: (v) => JSON.stringify(v, null, 2),
    slice: (v, start, end) =>
      typeof v === 'string' || Array.isArray(v)
        ? v.slice(start as number | undefined, end as number | undefined)
        : v,
    // `{{ names | join:', ' }}`: a list (or Set) as text, empty items as ''.
    join: (v, separator = ', ') =>
      Array.isArray(v) || v instanceof Set ? [...v].map(str).join(str(separator)) : str(v),
    // Drops null, undefined, false and '' — keeps 0, unlike filter(Boolean).
    compact: (v) =>
      Array.isArray(v) || v instanceof Set
        ? [...v].filter((x) => x !== null && x !== undefined && x !== false && x !== '')
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
