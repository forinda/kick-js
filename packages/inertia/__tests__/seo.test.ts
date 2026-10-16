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

describe('resolveMeta', () => {
  it("treats `$&` and `$'` in a title as text, not replacement patterns", async () => {
    const { resolveMeta } = await import('../src/seo')
    const meta = resolveMeta({ titleTemplate: '%s · App' }, { title: "Save $& 50% $'" })
    expect(meta!.title).toBe("Save $& 50% $' · App")
  })
})
