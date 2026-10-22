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
]

export interface PipeEnv {
  locale: string
  timeZone: string
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

/** Angular's `digitsInfo`: `minInt.minFrac-maxFrac`, e.g. `1.0-2`. */
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

/** Intl formatters are costly to build: one per locale and options, reused. */
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()
function numberFormat(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n|${locale}|${JSON.stringify(opts)}`
  let f = formatters.get(key) as Intl.NumberFormat | undefined
  if (!f) formatters.set(key, (f = new Intl.NumberFormat(locale, opts)))
  return f
}
function dateFormat(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d|${locale}|${JSON.stringify(opts)}`
  let f = formatters.get(key) as Intl.DateTimeFormat | undefined
  if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(locale, opts)))
  return f
}

const toNumber = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

export function builtinPipes(env: PipeEnv): Record<string, Pipe> {
  return {
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
      return dateFormat(env.locale, {
        ...preset,
        timeZone: (timeZone as string | undefined) ?? env.timeZone,
      }).format(d)
    },
    number: (v, info) => {
      const n = toNumber(v)
      return n === undefined ? '' : numberFormat(env.locale, digits(info)).format(n)
    },
    currency: (v, code, info) => {
      const n = toNumber(v)
      if (n === undefined) return ''
      return numberFormat(env.locale, {
        style: 'currency',
        currency: String(code ?? 'USD'),
        ...digits(info),
      }).format(n)
    },
    percent: (v, info) => {
      const n = toNumber(v)
      return n === undefined
        ? ''
        : numberFormat(env.locale, { style: 'percent', ...digits(info) }).format(n)
    },
  }
}
