/**
 * The i18n recipe (docs/guide/i18n.md), run for real: the locale contributor,
 * Accept-Language negotiation, a `t()` that reads the request's locale from
 * anywhere, plurals, and `runWithLocale` for work outside a request.
 * Keep this in step with the guide.
 */
import 'reflect-metadata'
import { AsyncLocalStorage } from 'node:async_hooks'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  Application,
  Container,
  Controller,
  Get,
  Service,
  defineHttpContextDecorator,
  getRequestValue,
  type RequestContext,
} from '../src/index'

// ── src/i18n/locale.ts ──────────────────────────────────────────────────

const LOCALES = ['en', 'fr', 'sw'] as const
type Locale = (typeof LOCALES)[number]
const DEFAULT_LOCALE: Locale = 'en'

// In the app: `declare module '@forinda/kickjs' { interface ContextMeta { locale: Locale } }`.
// This suite's context-meta.d.ts already declares `locale` for every test.

/** A supported locale for a language tag: exact, else its language (`fr-CA` → `fr`). */
function matchLocale(tag: unknown): Locale | undefined {
  if (typeof tag !== 'string' || !tag) return undefined
  const lower = tag.toLowerCase()
  const language = lower.split('-')[0]
  return LOCALES.find((l) => l === lower) ?? LOCALES.find((l) => l === language)
}

/** The best supported locale in an Accept-Language header, by its q-values. */
function negotiate(header: string | undefined): Locale | undefined {
  const ranked = (header ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1 }
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .toSorted((a, b) => b.q - a.q)
  for (const { tag } of ranked) {
    const locale = matchLocale(tag)
    if (locale) return locale
  }
  return undefined
}

const LoadLocale = defineHttpContextDecorator({
  key: 'locale',
  resolve: (ctx) => {
    const cookie = /(?:^|;\s*)lang=([^;]+)/.exec(String(ctx.headers.cookie ?? ''))?.[1]
    const locale =
      matchLocale(ctx.query.lang) ??
      matchLocale(cookie) ??
      matchLocale(ctx.user?.locale) ??
      negotiate(ctx.headers['accept-language'] as string | undefined) ??
      DEFAULT_LOCALE
    ctx.setHeader('Content-Language', locale)
    return locale
  },
})

// ── src/i18n/t.ts ───────────────────────────────────────────────────────

// In the app, one JSON file per locale: `import en from './messages/en.json'`.
const en = {
  greeting: 'Hello, {name}',
  'cart.items': { one: '{count} item', other: '{count} items' },
}
type Messages = typeof en
type MessageKey = keyof Messages
// `satisfies`: a locale missing a key fails the typecheck.
const catalogs = {
  en,
  fr: {
    greeting: 'Bonjour, {name}',
    'cart.items': { one: '{count} article', other: '{count} articles' },
  },
  sw: {
    greeting: 'Habari, {name}',
    'cart.items': { one: 'bidhaa {count}', other: 'bidhaa {count}' },
  },
} satisfies Record<Locale, Messages>

const override = new AsyncLocalStorage<Locale>()

/** The locale in force: `runWithLocale`'s, else the request's, else the default. */
function currentLocale(): Locale {
  return override.getStore() ?? getRequestValue('locale') ?? DEFAULT_LOCALE
}

/** Run `fn` in `locale` — a queue job, an email, anything outside a request. */
function runWithLocale<T>(locale: Locale, fn: () => T): T {
  return override.run(locale, fn)
}

function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  const locale = currentLocale()
  const entry: string | Record<string, string> = catalogs[locale][key]
  const text =
    typeof entry === 'string'
      ? entry
      : (entry[new Intl.PluralRules(locale).select(Number(vars.count ?? 0))] ?? entry.other!)
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
}

// ── the app ─────────────────────────────────────────────────────────────

@Service()
class CartService {
  summary(count: number) {
    return t('cart.items', { count }) // no ctx: the request's locale
  }
}

describe('i18n recipe', () => {
  beforeEach(() => Container.reset())

  async function boot() {
    @Controller()
    class Shop {
      @Get('/hello')
      hello(ctx: RequestContext) {
        const cart = Container.getInstance().resolve(CartService)
        ctx.json({ text: t('greeting', { name: 'Ada' }), cart: cart.summary(2) })
      }
    }
    const app = new Application({
      modules: [{ routes: () => ({ path: '/shop', controller: Shop }) } as never],
      contributors: [LoadLocale.registration],
    })
    await app.setup()
    return request(app.handle.bind(app))
  }

  it('negotiates Accept-Language by q-value, falling back to the language and the default', () => {
    expect(negotiate('de-DE, fr;q=0.8, en;q=0.5')).toBe('fr')
    expect(negotiate('fr-CA')).toBe('fr')
    expect(negotiate('de, ja;q=0.9')).toBeUndefined()
    expect(negotiate('fr;q=0, sw;q=0.1')).toBe('sw')
  })

  it("translates in the request's locale, in the handler and in a service", async () => {
    const http = await boot()
    const fr = await http.get('/api/v1/shop/hello').set('Accept-Language', 'fr-CA,en;q=0.5')
    expect(fr.body).toEqual({ text: 'Bonjour, Ada', cart: '2 articles' })
    expect(fr.headers['content-language']).toBe('fr')

    const cookie = await http.get('/api/v1/shop/hello').set('Cookie', 'lang=sw')
    expect(cookie.body.text).toBe('Habari, Ada')
    const query = await http.get('/api/v1/shop/hello?lang=fr').set('Accept-Language', 'sw')
    expect(query.body.text).toBe('Bonjour, Ada')
    const fallback = await http.get('/api/v1/shop/hello').set('Accept-Language', 'de')
    expect(fallback.body).toEqual({ text: 'Hello, Ada', cart: '2 items' })
  })

  it('runWithLocale sets the locale outside a request', () => {
    expect(t('cart.items', { count: 1 })).toBe('1 item')
    expect(runWithLocale('fr', () => t('cart.items', { count: 1 }))).toBe('1 article')
  })
})
