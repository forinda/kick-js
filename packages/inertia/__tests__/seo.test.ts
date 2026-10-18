import 'reflect-metadata'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '@forinda/kickjs/fastify'
import { h3Runtime } from '@forinda/kickjs/h3'
import { Application, Container, Controller, Get, expressRuntime } from '@forinda/kickjs'
import {
  InertiaAdapter,
  h,
  inertia,
  inertiaNotFound,
  robots,
  sitemap,
  type InertiaAdapterOptions,
} from '@forinda/kickjs-inertia'

const EVIL = '"><script>alert(1)</script>'

function ssrBundle(head: string[]): string {
  const file = join(mkdtempSync(join(tmpdir(), 'kick-inertia-seo-')), 'ssr.mjs')
  writeFileSync(
    file,
    `export default async () => ({ head: ${JSON.stringify(head)}, body: '<div id="app"></div>' })`,
  )
  return file
}

async function makeApp(options: Partial<InertiaAdapterOptions> = {}) {
  @Controller()
  class SeoController {
    @Get('/notes/1')
    note() {
      return inertia(
        'Notes/Show',
        { body: 'hi' },
        {
          meta: {
            title: EVIL,
            description: 'A note',
            og: { type: 'article', image: '/cover.png' },
            twitter: { card: 'summary' },
            jsonLd: { '@type': 'Article', headline: '</script><script>alert(1)</script>' },
          },
        },
      )
    }

    @Get('/plain')
    plain() {
      return inertia('Plain')
    }

    @Get('/fr/notes/1')
    french() {
      return inertia(
        'Notes/Show',
        {},
        {
          meta: {
            title: 'Note',
            lang: 'fr',
            head: [
              h('meta', { name: 'theme-color', content: EVIL }),
              h('link', { rel: 'alternate', hreflang: 'en', href: '/notes/1' }),
            ],
          },
        },
      )
    }

    @Get('/sitemap.xml')
    sitemap() {
      return sitemap(
        [
          { loc: '/', changefreq: 'daily', priority: 1 },
          { loc: '/search?q=a&b=<c>', lastmod: new Date('2026-10-16T00:00:00Z') },
        ],
        { baseUrl: 'https://example.com' },
      )
    }

    @Get('/seo/robots.txt')
    robots() {
      return robots({
        disallow: ['/admin', '/x\nAllow: /secret'],
        sitemap: '/sitemap.xml',
        baseUrl: 'https://example.com',
      })
    }
  }

  const app = new Application({
    runtime: current.make(),
    modules: [
      {
        routes: () => ({ path: '/', prefix: false, version: false, controller: SeoController }),
      } as never,
    ],
    adapters: [
      InertiaAdapter({
        clientDir: mkdtempSync(join(tmpdir(), 'kick-inertia-none-')),
        version: 'v1',
        errorPage: 'Error',
        ...options,
      }),
    ],
    onNotFound: inertiaNotFound(),
  })
  await app.setup()
  return request(app.handle.bind(app))
}

const RUNTIMES = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
] as const
let current: (typeof RUNTIMES)[number] = RUNTIMES[0]

for (const rt of RUNTIMES)
  describe(`SEO — ${rt.name}`, () => {
    beforeEach(() => {
      Container.reset()
      current = rt
    })

    it('renders the meta into the first-visit HTML, escaped', async () => {
      const res = await (await makeApp()).get('/notes/1').expect(200)
      const head = res.text.split('</head>')[0]!
      expect(head).toContain(
        '<title data-inertia="">&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>',
      )
      expect(head).not.toContain('<script>alert(1)')
      expect(head).toContain(
        '<meta data-inertia="description" name="description" content="A note" />',
      )
      expect(head).toContain('property="og:type" content="article"')
      expect(head).toContain('name="twitter:card" content="summary"')
      // og:title defaults to the page title.
      expect(head).toContain('property="og:title" content="&quot;&gt;&lt;script&gt;')
      expect(head.match(/<title/g)).toHaveLength(1)
    })

    it('escapes JSON-LD so a value cannot close its script tag', async () => {
      const res = await (await makeApp()).get('/notes/1').expect(200)
      const ld = res.text.match(/<script data-inertia="json-ld"[^>]*>([\s\S]*?)<\/script>/)![1]!
      expect(ld).not.toContain('<')
      expect(JSON.parse(ld)).toEqual({
        '@type': 'Article',
        headline: '</script><script>alert(1)</script>',
      })
    })

    it('sends the meta to the client on an Inertia visit', async () => {
      const res = await (
        await makeApp({ meta: { titleTemplate: '%s · App' } })
      )
        .get('/notes/1')
        .set({ 'X-Inertia': 'true', 'X-Inertia-Version': 'v1' })
        .expect(200)
      expect(res.body.meta.title).toBe(`${EVIL} · App`)
      expect(res.body.meta.og.type).toBe('article')
    })

    it('merges the defaults under the page meta and applies the title template', async () => {
      const app = await makeApp({
        meta: {
          title: 'App',
          titleTemplate: '%s · App',
          description: 'Default description',
          robots: 'index, follow',
          og: { image: '/default.png', site_name: 'App' },
        },
        baseUrl: 'https://example.com/',
      })
      const note = (await app.get('/notes/1').expect(200)).text
      expect(note).toContain(`${'&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'} · App</title>`)
      expect(note).toContain('name="description" content="A note"')
      expect(note).toContain('name="robots" content="index, follow"')
      expect(note).toContain('property="og:image" content="https://example.com/cover.png"')
      expect(note).toContain('property="og:site_name" content="App"')

      // A page without meta gets the defaults, its title untemplated.
      const plain = (await app.get('/plain').expect(200)).text
      expect(plain).toContain('<title data-inertia="">App</title>')
      expect(plain).toContain('name="description" content="Default description"')
      expect(plain).toContain('property="og:image" content="https://example.com/default.png"')
    })

    it('builds the canonical URL from baseUrl, never the Host header', async () => {
      const app = await makeApp({ baseUrl: 'https://example.com' })
      const res = await app
        .get('/plain?utm=1')
        .set('Host', 'evil.test')
        .set('X-Forwarded-Host', 'evil.test')
        .expect(200)
      expect(res.text).toContain('rel="canonical" href="https://example.com/plain"')
      expect(res.text).toContain('property="og:url" content="https://example.com/plain"')
      expect(res.text).not.toContain('evil.test')
    })

    it('marks error pages noindex, without a canonical', async () => {
      const app = await makeApp({ baseUrl: 'https://example.com' })
      const res = await app.get('/missing').set('Accept', 'text/html').expect(404)
      expect(res.text).toContain('name="robots" content="noindex"')
      expect(res.text).not.toContain('rel="canonical"')
    })

    it('lets a server-rendered <Head> win over the same tags from meta', async () => {
      const app = await makeApp({
        ssr: {
          entry: 'src/client/ssr.tsx',
          bundle: ssrBundle([
            '<title data-inertia="">From Head</title>',
            '<meta name="description" content="From Head" data-inertia="">',
          ]),
        },
      })
      const res = await app.get('/notes/1').expect(200)
      expect(res.text.match(/<title/g)).toHaveLength(1)
      expect(res.text).toContain('<title data-inertia="">From Head</title>')
      expect(res.text.match(/name="description"/g)).toHaveLength(1)
      expect(res.text).toContain('content="From Head"')
      // Tags the <Head> didn't set are still there.
      expect(res.text).toContain('property="og:type" content="article"')
    })

    it('renders head tags from h(): escaped, a page tag over the default, alternates absolute', async () => {
      const app = await makeApp({
        baseUrl: 'https://example.com',
        meta: {
          head: [
            h('meta', { name: 'theme-color', content: '#000' }),
            h('link', { rel: 'alternate', hreflang: 'fr', href: '/fr/notes/1' }),
          ],
        },
      })
      const head = (await app.get('/fr/notes/1').expect(200)).text.split('</head>')[0]!
      expect(head.match(/name="theme-color"/g)).toHaveLength(1)
      expect(head).toContain(
        '<meta data-inertia="meta:theme-color" name="theme-color" content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" />',
      )
      expect(head).not.toContain('<script>alert(1)')
      expect(head).toContain(
        '<link data-inertia="link:alternate:en" rel="alternate" hreflang="en" href="https://example.com/notes/1" />',
      )
      expect(head).toContain('hreflang="fr" href="https://example.com/fr/notes/1"')

      // The defaults alone on a page without its own.
      const plain = (await app.get('/plain').expect(200)).text
      expect(plain).toContain('name="theme-color" content="#000"')
    })

    it('sets <html lang> from meta.lang, escaped; en by default', async () => {
      const app = await makeApp()
      expect((await app.get('/fr/notes/1').expect(200)).text).toContain('<html lang="fr">')
      expect((await app.get('/plain').expect(200)).text).toContain('<html lang="en">')
      const evil = await makeApp({ meta: { lang: EVIL } })
      const res = (await evil.get('/plain').expect(200)).text
      expect(res).toContain('<html lang="&quot;&gt;&lt;script&gt;')
    })

    it('puts the title and meta ahead of the asset tags', async () => {
      const res = await (
        await makeApp({ head: '<link rel="icon" href="/favicon.svg" />' })
      )
        .get('/notes/1')
        .expect(200)
      expect(res.text.indexOf('<title')).toBeLessThan(res.text.indexOf('rel="icon"'))
    })

    it('drops an h() tag a server-rendered <Head> already set', async () => {
      const app = await makeApp({
        ssr: {
          entry: 'src/client/ssr.tsx',
          bundle: ssrBundle(['<meta name="theme-color" content="#fff" data-inertia="">']),
        },
      })
      const res = await app.get('/fr/notes/1').expect(200)
      expect(res.text.match(/name="theme-color"/g)).toHaveLength(1)
      expect(res.text).toContain('content="#fff"')
    })

    it('answers /sitemap.xml with escaped, absolute URLs', async () => {
      const res = await (await makeApp()).get('/sitemap.xml').expect(200)
      expect(res.headers['content-type']).toMatch(/^application\/xml/)
      expect(res.text).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
      expect(res.text).toContain('<loc>https://example.com/</loc>')
      expect(res.text).toContain('<changefreq>daily</changefreq>')
      expect(res.text).toContain('<priority>1.0</priority>')
      expect(res.text).toContain(
        '<loc>https://example.com/search?q=a&amp;b=&lt;c&gt;</loc>\n    <lastmod>2026-10-16T00:00:00.000Z</lastmod>',
      )
    })

    it('answers /robots.txt, and a line break in a value cannot add a rule', async () => {
      const res = await (await makeApp()).get('/seo/robots.txt').expect(200)
      expect(res.headers['content-type']).toMatch(/^text\/plain/)
      expect(res.text).toBe(
        'User-agent: *\nDisallow: /admin\nDisallow: /xAllow: /secret\n\nSitemap: https://example.com/sitemap.xml\n',
      )
    })
  })

describe('InertiaAdapter baseUrl', () => {
  it('must be an absolute http(s) URL', () => {
    expect(() => InertiaAdapter({ baseUrl: 'example.com' })).toThrow(/baseUrl must be an absolute/)
  })
})

describe('h()', () => {
  it('builds meta and link tags keyed by what they set', () => {
    expect(h('meta', { property: 'og:locale', content: 'fr_FR' }).key).toBe('meta:og:locale')
    expect(h('link', { rel: 'preload', as: 'image', href: '/a.png' }).key).toBe(
      'link:preload:/a.png',
    )
    expect(h('link', { rel: 'canonical', href: '/x' }).key).toBe('canonical')
  })

  it('refuses other tags, event handlers, odd attribute names and keyless tags', () => {
    expect(() => h('script' as never, {})).toThrow(/only meta and link/)
    expect(() => h('link', { rel: 'preload', onload: 'alert(1)' })).toThrow(/onload/)
    expect(() => h('meta', { name: 'x', 'a"b': '1' })).toThrow(/not allowed/)
    expect(() => h('meta', { content: 'x' })).toThrow(/name, property or http-equiv/)
    expect(() => h('link', { href: '/x' })).toThrow(/needs a rel/)
  })
})

describe('resolveMeta', () => {
  it('gives /posts and /posts/ one canonical, without the query', async () => {
    const { resolveMeta } = await import('../src/seo')
    const at = (path: string) =>
      resolveMeta({}, {}, { baseUrl: 'https://example.com', path })!.canonical
    expect(at('/posts/')).toBe('https://example.com/posts')
    expect(at('/posts//?page=2')).toBe('https://example.com/posts')
    expect(at('/')).toBe('https://example.com/')
  })

  it("treats `$&` and `$'` in a title as text, not replacement patterns", async () => {
    const { resolveMeta } = await import('../src/seo')
    const meta = resolveMeta({ titleTemplate: '%s · App' }, { title: "Save $& 50% $'" })
    expect(meta!.title).toBe("Save $& 50% $' · App")
  })
})
