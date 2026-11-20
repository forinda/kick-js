/**
 * Message catalogues for the `t` pipe: `<viewsDir>/locales/<locale>.json`,
 * nested keys addressed with dots, plural forms picked by `Intl.PluralRules`.
 *
 * ```json
 * { "cart": { "title": "Cart", "items": { "one": "{count} item", "other": "{count} items" } } }
 * ```
 */

export const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const
export type PluralForm = (typeof PLURAL_FORMS)[number]

/** A message: text, or one text per plural form (`other` required). */
export type Message = string | Partial<Record<PluralForm, string>>
/** Locale → dot key → message. */
export type Messages = Record<string, Record<string, Message>>

const isForm = (k: string): k is PluralForm => (PLURAL_FORMS as readonly string[]).includes(k)
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A catalogue file's JSON as dot keys. An object whose keys are all plural forms is one message. */
export function flattenCatalog(json: unknown, file: string): Record<string, Message> {
  if (!isObject(json)) throw new Error(`${file}: a catalogue is a JSON object of messages`)
  const out: Record<string, Message> = {}
  const walk = (obj: Record<string, unknown>, prefix: string): void => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k
      if (typeof v === 'string') out[key] = v
      else if (isObject(v) && Object.keys(v).length && Object.keys(v).every(isForm)) {
        if (typeof v.other !== 'string')
          throw new Error(`${file}: '${key}' has plural forms but no 'other'`)
        for (const [form, text] of Object.entries(v))
          if (typeof text !== 'string') throw new Error(`${file}: '${key}.${form}' must be text`)
        out[key] = v as Message
      } else if (isObject(v)) walk(v, key)
      else throw new Error(`${file}: '${key}' must be text, plural forms or nested messages`)
    }
  }
  walk(json, '')
  return out
}

/** The `{name}` placeholders a message uses, across its forms. */
export function placeholders(m: Message): Set<string> {
  const out = new Set<string>()
  for (const text of typeof m === 'string' ? [m] : Object.values(m))
    for (const hit of (text ?? '').matchAll(/\{(\w+)\}/g)) out.add(hit[1]!)
  return out
}

/** What the check knows of the catalogues: each key's locales and placeholders. */
export interface CatalogIndex {
  /** The catalogue folder, as messages name it (`src/views/locales`). */
  where: string
  locales: string[]
  keys: Map<string, { locales: Set<string>; params: Set<string> }>
}

/** The catalogues indexed for checking `t` calls. */
export function catalogIndex(messages: Messages, where: string): CatalogIndex {
  const keys: CatalogIndex['keys'] = new Map()
  for (const [locale, catalog] of Object.entries(messages)) {
    for (const [key, m] of Object.entries(catalog)) {
      let entry = keys.get(key)
      if (!entry) keys.set(key, (entry = { locales: new Set(), params: new Set() }))
      entry.locales.add(locale)
      for (const p of placeholders(m)) entry.params.add(p)
    }
  }
  return { where, locales: Object.keys(messages), keys }
}

/** `sw-KE` → `sw`; `zh-Hant-TW` → `zh`. */
const language = (locale: string) => locale.split('-')[0]!

/**
 * `(locale, key, params) => text`: the locale's message, else its language's,
 * else the default locale's (and its language's), else the key — with one
 * `warn` per missing key and locale.
 */
export function createTranslator(
  messages: Messages,
  opts: { defaultLocale: string; warn?: (message: string) => void },
): (locale: string, key: string, params?: Record<string, unknown>) => string {
  const warned = new Set<string>()
  const plurals = new Map<string, Intl.PluralRules>()
  const numbers = new Map<string, Intl.NumberFormat>()
  const of = <T>(cache: Map<string, T>, locale: string, make: (l?: string) => T): T => {
    let v = cache.get(locale)
    if (!v) {
      // Locales can come from requests: keep the caches small, and let a
      // tag Intl refuses fall back to the runtime's default.
      if (cache.size >= 64) cache.clear()
      try {
        v = make(locale)
      } catch {
        v = make()
      }
      cache.set(locale, v)
    }
    return v
  }
  return (locale, key, params = {}) => {
    const chain = [locale, language(locale), opts.defaultLocale, language(opts.defaultLocale)]
    let found: { m: Message; locale: string } | undefined
    for (const l of chain) {
      const m = messages[l]?.[key]
      if (m !== undefined) {
        found = { m, locale: l }
        break
      }
    }
    if (!found) {
      if (!warned.has(`${locale}\0${key}`)) {
        // Locales and keys can come from requests: a capped set, like the Intl caches.
        if (warned.size >= 1024) warned.clear()
        warned.add(`${locale}\0${key}`)
        opts.warn?.(`no message '${key}' for ${locale}`)
      }
      return key
    }
    const { m } = found
    let text: string
    if (typeof m === 'string') text = m
    else {
      const count = Number(params.count)
      const form =
        count === 0 && m.zero !== undefined
          ? 'zero'
          : of(plurals, found.locale, (l) => new Intl.PluralRules(l)).select(count)
      text = m[form] ?? m.other!
    }
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
      if (!Object.hasOwn(params, name)) return whole
      const v = params[name]
      return typeof v === 'number'
        ? of(numbers, locale, (l) => new Intl.NumberFormat(l)).format(v)
        : String(v ?? '')
    })
  }
}
