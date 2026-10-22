/**
 * The few functions every rendered value passes through: a property read
 * that can't reach prototypes or functions, and escaping for each place a
 * value can land (spec §3, §4).
 */
import { FORBIDDEN_NAMES } from '../parse/expression'

export { isUrlAttr, URL_ATTRS } from '../urls'

/** HTML a pipe or the app marked as trusted: printed unescaped, in text only. */
export class SafeHtml {
  constructor(readonly html: string) {}
  toString(): string {
    return this.html
  }
}

/**
 * Read `obj[key]` for a template. Forbidden names and function values read
 * as `undefined`, so a template can neither reach a prototype nor get hold of
 * something to call. Getters and Proxy traps run: they are the app's own code.
 */
export function read(obj: unknown, key: unknown): unknown {
  if (obj === null || obj === undefined) return undefined
  const k = typeof key === 'number' || typeof key === 'symbol' ? key : String(key)
  if (typeof k === 'string' && FORBIDDEN_NAMES.has(k)) return undefined
  const value = (obj as Record<PropertyKey, unknown>)[k]
  return typeof value === 'function' ? undefined : value
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!)

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])

/**
 * A URL attribute's value, or `#` when its scheme could run script.
 * Browsers ignore ASCII whitespace and control characters inside a scheme
 * (`java\tscript:`), so those are removed before the scheme is read.
 */
export function sanitizeUrl(value: string): string {
  // oxlint-disable-next-line no-control-regex -- matching control characters is the point
  const normalised = value.replace(/[\u0000- \u007F]/g, '')
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(normalised)
  if (!m) return value
  return SAFE_SCHEMES.has(m[1]!.toLowerCase()) ? value : '#'
}

/** `srcset`: each candidate URL is checked on its own. */
export function sanitizeSrcset(value: string): string {
  return value
    .split(',')
    .map((candidate) => {
      const m = /^(\s*)(\S+)([\s\S]*)$/.exec(candidate)
      if (!m) return candidate
      return `${m[1]}${sanitizeUrl(m[2]!)}${m[3]}`
    })
    .join(',')
}

const JSON_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

/** JSON text made safe inside `<script type="application/json">`: no `</script`, no `<!--`. */
export const escapeJsonForScript = (json: string): string =>
  json.replace(/[<>&\u2028\u2029]/g, (c) => JSON_ESCAPES[c]!)

/** A CSS value for `[style.prop]`, or `undefined` when it could leave its property. */
export function safeStyleValue(v: string): string | undefined {
  return /[;{}\\"'<]|\/\*|url\s*\(|expression\s*\(/i.test(v) ? undefined : v
}
