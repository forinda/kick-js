/**
 * Search-engine support: page meta set by the handler (rendered into the
 * first-visit HTML and sent to the client on every visit), plus
 * `sitemap()` and `robots()` responses.
 *
 * @module @forinda/kickjs-inertia/seo
 */
import { RESPOND, type RequestContext, type Respondable } from '@forinda/kickjs'

/** A page's title, description and social tags. Every value is escaped on output. */
export interface PageMeta {
  title?: string
  description?: string
  /** A path (`'/posts/1'`, made absolute with `baseUrl`) or a full URL. */
  canonical?: string
  /** E.g. `'noindex, nofollow'`. */
  robots?: string
  /** Open Graph, without the `og:` prefix: `{ type: 'article', image: '/cover.png' }`. */
  og?: Record<string, string>
  /** Twitter cards, without the `twitter:` prefix: `{ card: 'summary_large_image' }`. */
  twitter?: Record<string, string>
  /** Structured data, rendered as `<script type="application/ld+json">`. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
}

/** Adapter-wide meta, under each page's. */
export interface MetaDefaults extends PageMeta {
  /** Wraps a page's title: `'%s · My App'`. Not applied to the default `title`. */
  titleTemplate?: string
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A site path made absolute with `baseUrl`; anything else is left as it is. */
function absolute(value: string | undefined, baseUrl: string | undefined): string | undefined {
  if (!value || !baseUrl || !/^\/(?![/\\])/.test(value)) return value
  return baseUrl.replace(/\/+$/, '') + value
}

/**
 * The meta a page is sent with: `defaults` under `meta`, the title template
 * applied, and paths made absolute with `baseUrl`. Without a `canonical`, a
 * successful page gets `baseUrl` + its path (no query) — never the request's
 * Host header, which the client chooses.
 */
export function resolveMeta(
  defaults: MetaDefaults = {},
  meta: PageMeta = {},
  options: { baseUrl?: string; path?: string; status?: number } = {},
): PageMeta | undefined {
  const { titleTemplate, ...base } = defaults
  const { baseUrl, path, status = 200 } = options
  const title =
    meta.title !== undefined && titleTemplate
      ? titleTemplate.replace('%s', meta.title)
      : (meta.title ?? base.title)
  const description = meta.description ?? base.description
  let canonical = meta.canonical ?? base.canonical
  if (canonical === undefined && baseUrl && path !== undefined && status < 300) {
    canonical = path.split(/[?#]/)[0]
  }
  canonical = absolute(canonical, baseUrl)

  const og = { ...base.og, ...meta.og }
  og.title ??= meta.title ?? base.title!
  og.description ??= description!
  og.url ??= canonical!
  og.image = absolute(og.image, baseUrl)!
  const twitter = { ...base.twitter, ...meta.twitter }
  twitter.image = absolute(twitter.image, baseUrl)!

  const strip = (r: Record<string, string>) =>
    Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))
  const out: PageMeta = {
    title,
    description,
    canonical,
    robots: meta.robots ?? base.robots,
    og: strip(og),
    twitter: strip(twitter),
    jsonLd: meta.jsonLd ?? base.jsonLd,
  }
  for (const key of Object.keys(out) as (keyof PageMeta)[]) {
    const v = out[key]
    if (v === undefined || (typeof v === 'object' && !Object.keys(v).length)) delete out[key]
  }
  return Object.keys(out).length ? out : undefined
}

/** JSON for a `<script>` body: `<` escaped, so a value can't close the tag. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

/**
 * The meta as head tags. Each carries `data-inertia="<key>"` — what Inertia's
 * `<Head>` gives a tag with that `head-key` — so the client takes them over
 * and replaces them on the next visit instead of leaving them behind.
 */
export function metaTags(meta: PageMeta | undefined): string[] {
  if (!meta) return []
  const tags: string[] = []
  const m = (attr: 'name' | 'property', key: string, value: string) =>
    tags.push(
      `<meta data-inertia="${escapeHtml(key)}" ${attr}="${escapeHtml(key)}" content="${escapeHtml(value)}" />`,
    )
  if (meta.title !== undefined)
    tags.push(`<title data-inertia="">${escapeHtml(meta.title)}</title>`)
  if (meta.description !== undefined) m('name', 'description', meta.description)
  if (meta.robots !== undefined) m('name', 'robots', meta.robots)
  if (meta.canonical !== undefined) {
    tags.push(
      `<link data-inertia="canonical" rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
    )
  }
  for (const [k, v] of Object.entries(meta.og ?? {})) m('property', `og:${k}`, v)
  for (const [k, v] of Object.entries(meta.twitter ?? {})) m('name', `twitter:${k}`, v)
  if (meta.jsonLd !== undefined) {
    tags.push(
      `<script data-inertia="json-ld" type="application/ld+json">${scriptJson(meta.jsonLd)}</script>`,
    )
  }
  return tags
}

/** What a head tag sets — two tags with the same key are duplicates. */
function tagKey(tag: string): string | null {
  const attr = (name: string) =>
    tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]?.toLowerCase()
  if (/^<title[\s>]/i.test(tag)) return 'title'
  if (/^<meta\s/i.test(tag)) {
    const key = attr('name') ?? attr('property')
    return key ? `meta:${key}` : null
  }
  if (/^<link\s/i.test(tag) && attr('rel') === 'canonical') return 'canonical'
  if (/^<script\s/i.test(tag) && attr('type') === 'application/ld+json') return 'json-ld'
  return null
}

/** `tags` minus the ones `winners` (a server-rendered `<Head>`) already set. */
export function dedupeHead(tags: string[], winners: string[]): string[] {
  const taken = new Set(winners.map((t) => tagKey(t.trim())).filter(Boolean))
  return tags.filter((t) => !taken.has(tagKey(t)))
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

export interface SitemapEntry {
  /** A full URL, or a path made absolute with `baseUrl`. */
  loc: string
  /** A `Date`, or a W3C date string (`'2026-10-16'`). */
  lastmod?: Date | string
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  /** 0.0 – 1.0. */
  priority?: number
}

/** The sitemap XML for `entries`. Paths are made absolute with `baseUrl`. */
export function sitemapXml(entries: Iterable<SitemapEntry>, baseUrl?: string): string {
  const urls = [...entries].map((e) => {
    const lastmod = e.lastmod instanceof Date ? e.lastmod.toISOString() : e.lastmod
    return [
      '  <url>',
      `    <loc>${escapeXml(absolute(e.loc, baseUrl)!)}</loc>`,
      lastmod && `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
      e.changefreq && `    <changefreq>${e.changefreq}</changefreq>`,
      e.priority !== undefined && `    <priority>${Number(e.priority).toFixed(1)}</priority>`,
      '  </url>',
    ]
      .filter(Boolean)
      .join('\n')
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`
}

/**
 * Answer `/sitemap.xml`. Return it from a handler:
 *
 * ```ts
 * @Get('/sitemap.xml')
 * sitemap() {
 *   return sitemap([{ loc: '/' }, { loc: '/posts', changefreq: 'daily' }], { baseUrl: getEnv('APP_URL') })
 * }
 * ```
 */
export function sitemap(
  entries: Iterable<SitemapEntry>,
  options: { baseUrl?: string } = {},
): Respondable {
  const xml = sitemapXml(entries, options.baseUrl)
  return {
    [RESPOND](ctx: RequestContext) {
      ctx.send(xml, { type: 'application/xml; charset=utf-8' })
    },
  }
}

export interface RobotsOptions {
  /** Default `'*'`. */
  userAgent?: string
  allow?: string[]
  disallow?: string[]
  /** Sitemap URL(s) — a path is made absolute with `baseUrl`. */
  sitemap?: string | string[]
  baseUrl?: string
}

/** The robots.txt text. Line breaks in values are dropped, so one can't add a rule. */
export function robotsTxt(options: RobotsOptions = {}): string {
  const clean = (v: string) => v.replace(/[\r\n]+/g, '')
  const lines = [`User-agent: ${clean(options.userAgent ?? '*')}`]
  for (const p of options.allow ?? []) lines.push(`Allow: ${clean(p)}`)
  for (const p of options.disallow ?? []) lines.push(`Disallow: ${clean(p)}`)
  if (!options.allow?.length && !options.disallow?.length) lines.push('Allow: /')
  const maps = options.sitemap === undefined ? [] : [options.sitemap].flat()
  if (maps.length)
    lines.push('', ...maps.map((s) => `Sitemap: ${clean(absolute(s, options.baseUrl)!)}`))
  return `${lines.join('\n')}\n`
}

/** Answer `/robots.txt`. */
export function robots(options: RobotsOptions = {}): Respondable {
  const text = robotsTxt(options)
  return {
    [RESPOND](ctx: RequestContext) {
      ctx.send(text)
    },
  }
}
