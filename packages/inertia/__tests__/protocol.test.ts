import 'reflect-metadata'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '@forinda/kickjs/fastify'
import { h3Runtime } from '@forinda/kickjs/h3'
import {
  Application,
  Container,
  expressRuntime,
  Controller,
  Get,
  Post,
  Put,
  Middleware,
  HttpException,
  session,
  type RequestContext,
} from '@forinda/kickjs'
import {
  InertiaAdapter,
  always,
  defer,
  flash,
  inertia,
  inertiaErrorHandler,
  inertiaNotFound,
  location,
  merge,
  once,
  optional,
  precognitive,
  redirect,
  scroll,
} from '@forinda/kickjs-inertia'
import { previousUrl } from '../src/inertia'

/** A minimal Standard Schema: `title` must be a non-empty string. */
const titleSchema = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v: any) =>
      typeof v?.title === 'string' && v.title.length > 0
        ? { value: v }
        : { issues: [{ message: 'Title is required', path: ['title'] }] },
  },
}

function clientBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kick-inertia-'))
  mkdirSync(join(dir, '.vite'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'main-abc.js'), 'console.log(1)')
  // Copied by Vite from public/.
  writeFileSync(join(dir, 'robots.txt'), 'User-agent: *')
  writeFileSync(
    join(dir, '.vite', 'manifest.json'),
    JSON.stringify({
      'src/client/main.tsx': {
        file: 'assets/main-abc.js',
        css: ['assets/main-abc.css'],
        imports: ['_vendor.js'],
      },
      '_vendor.js': { file: 'assets/vendor-def.js' },
    }),
  )
  return dir
}

async function makeApp(
  options: { version?: string | null; ssrBundle?: string; errorPage?: string } = {},
) {
  @Controller()
  class PagesController {
    @Get('/users')
    users() {
      return inertia('Users/Index', {
        users: () => [{ id: 1, name: 'Ada' }],
        stats: optional(() => ({ total: 1 })),
        activity: defer(() => ['login'], 'side'),
        feed: merge(() => [1, 2]),
        now: always(() => 'tick'),
        html: '</script><script>alert(1)</script>',
      })
    }

    @Post('/posts', { body: titleSchema })
    create(ctx: RequestContext) {
      flash(ctx, { success: 'Created' })
      return redirect('/posts')
    }

    @Get('/posts')
    posts() {
      return inertia('Posts/Index')
    }

    @Put('/posts/1')
    update(ctx: RequestContext) {
      ctx.redirect('/posts')
    }

    @Get('/boom')
    boom() {
      throw new Error('database is down')
    }

    @Get('/secret')
    secret() {
      throw new HttpException(403, 'Members only')
    }

    @Get('/away')
    away() {
      return location('https://example.com/out')
    }

    @Get('/feed')
    feed(ctx: RequestContext) {
      const page = Number(ctx.query.page ?? 1)
      return inertia('Feed', {
        plans: once(() => ['free', 'pro'], { ttl: 60_000 }),
        countries: once(() => ['KE'], { key: 'geo' }),
        posts: scroll(
          () => ({
            data: [{ id: page }],
            meta: { page, hasNext: page < 3, hasPrev: page > 1 },
          }),
          { matchOn: 'id' },
        ),
        tags: merge(() => [{ slug: 'a' }], 'append', { matchOn: 'slug' }),
      })
    }

    @Post('/comments')
    comment() {
      return redirect('/posts/1#comments')
    }

    @Post('/keep')
    keep() {
      return redirect('/posts', { preserveFragment: true })
    }

    @Post('/users', { body: titleSchema })
    @Middleware(precognitive)
    createUser() {
      return redirect('/users')
    }
  }

  const app = new Application({
    runtime: current.make(),
    modules: [
      {
        routes: () => ({ path: '/', prefix: false, version: false, controller: PagesController }),
      } as never,
    ],
    middlewares: [
      // Stands in for cors(): a Vary set by another layer must survive.
      (_req: any, res: any, next: () => void) => {
        res.setHeader('Vary', 'Origin')
        next()
      },
      // Express needs a body parser; Fastify and h3 parse bodies natively.
      ...(current.name === 'express' ? [express.json()] : []),
      session({ secret: 'test-secret-test-secret' }),
    ],
    adapters: [
      InertiaAdapter({
        clientDir: clientBuild(),
        ...(options.version === null ? {} : { version: options.version ?? 'v1' }),
        share: () => ({ appName: 'Kick' }),
        head: '<link rel="icon" href="/favicon.svg" />',
        errorPage: options.errorPage,
        ...(options.ssrBundle
          ? { ssr: { entry: 'src/client/ssr.tsx', bundle: options.ssrBundle } }
          : {}),
      }),
    ],
    onError: inertiaErrorHandler(),
    onNotFound: inertiaNotFound(),
  })
  await app.setup()
  return app
}

const X = { 'X-Inertia': 'true', 'X-Inertia-Version': 'v1' }

const RUNTIMES = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
] as const
let current: (typeof RUNTIMES)[number] = RUNTIMES[0]

for (const rt of RUNTIMES)
  describe(`InertiaAdapter — ${rt.name}`, () => {
    beforeEach(() => {
      Container.reset()
      current = rt
    })

    it('renders the HTML shell with the page and the built assets on a first visit', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/users').expect(200)

      expect(res.headers['content-type']).toMatch(/html/)
      expect(res.text).toContain('<script type="module" src="/assets/main-abc.js"></script>')
      expect(res.text).toContain('<link rel="stylesheet" href="/assets/main-abc.css" />')
      expect(res.text).toContain('<link rel="modulepreload" href="/assets/vendor-def.js" />')
      expect(res.text).not.toContain('</script><script>alert')

      const json = /<script data-page="app" type="application\/json">(.*?)<\/script>/.exec(
        res.text,
      )![1]
      const page = JSON.parse(json)
      expect(page.component).toBe('Users/Index')
      expect(page.url).toBe('/users')
      expect(page.props.users).toEqual([{ id: 1, name: 'Ada' }])
      expect(page.props.html).toBe('</script><script>alert(1)</script>')
      expect(page.props.appName).toBe('Kick')
      expect(page.props.errors).toEqual({})
      expect(page.sharedProps).toEqual(['appName'])
    })

    it('answers an Inertia visit with the page as JSON', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/users').set(X).expect(200)

      expect(res.headers['x-inertia']).toBe('true')
      expect(res.headers.vary).toBe('Origin, X-Inertia')
      expect(res.body.component).toBe('Users/Index')
      expect(res.body.props).not.toHaveProperty('stats') // optional: only when asked
      expect(res.body.props).not.toHaveProperty('activity') // deferred
      expect(res.body.deferredProps).toEqual({ side: ['activity'] })
      expect(res.body.mergeProps).toEqual(['feed'])
      expect(res.body.props.now).toBe('tick')
    })

    it('sends only the props a partial reload asks for, plus always props', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app))
        .get('/users')
        .set({
          ...X,
          'X-Inertia-Partial-Component': 'Users/Index',
          'X-Inertia-Partial-Data': 'stats,activity',
        })
        .expect(200)

      expect(Object.keys(res.body.props).toSorted()).toEqual(['activity', 'errors', 'now', 'stats'])
      expect(res.body.props.activity).toEqual(['login'])
      expect(res.body.deferredProps).toBeUndefined()
    })

    it('ignores partial headers aimed at another component', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app))
        .get('/users')
        .set({ ...X, 'X-Inertia-Partial-Component': 'Other', 'X-Inertia-Partial-Data': 'stats' })
        .expect(200)
      expect(res.body.props).toHaveProperty('users')
      expect(res.body.props).not.toHaveProperty('stats')
    })

    it('answers a stale asset version with 409 and the URL to reload', async () => {
      const app = await makeApp({ version: 'v2' })
      const res = await request(app.handle.bind(app))
        .get('/users?page=2')
        .set({ ...X, 'X-Inertia-Version': 'v1' })
        .expect(409)
      expect(res.headers['x-inertia-location']).toBe('/users?page=2')

      await request(app.handle.bind(app))
        .get('/users')
        .set({ ...X, 'X-Inertia-Version': 'v2' })
        .expect(200)
    })

    it('defaults the version to a hash of the build manifest', async () => {
      const app = await makeApp({ version: null })
      const res = await request(app.handle.bind(app)).get('/users').expect(200)
      const version = /"version":"([0-9a-f]{12})"/.exec(res.text)?.[1]
      expect(version).toMatch(/^[0-9a-f]{12}$/)
      await request(app.handle.bind(app))
        .get('/users')
        .set({ 'X-Inertia': 'true', 'X-Inertia-Version': version! })
        .expect(200)
    })

    it('turns a 302 after PUT into a 303', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).put('/posts/1').set(X).expect(303)
      expect(res.headers.location).toBe('/posts')
    })

    it('redirects a failed submit back with the errors, and shows them once', async () => {
      const app = await makeApp()
      const agent = request.agent(app.handle.bind(app))

      const res = await agent
        .post('/posts')
        .set({ ...X, Host: 'app.test', Referer: 'http://app.test/posts/new?draft=1' })
        .send({ title: '' })
        .expect(303)
      expect(res.headers.location).toBe('/posts/new?draft=1')

      const next = await agent.get('/posts').set(X).expect(200)
      expect(next.body.props.errors).toEqual({ title: 'Title is required' })

      const again = await agent.get('/posts').set(X).expect(200)
      expect(again.body.props.errors).toEqual({})
    })

    it('goes back to the last rendered page when the browser sends no Referer', async () => {
      const app = await makeApp()
      const agent = request.agent(app.handle.bind(app))
      await agent.get('/users').set(X).expect(200)
      const res = await agent.post('/posts').set(X).send({}).expect(303)
      expect(res.headers.location).toBe('/users')
    })

    it('never sends a failed submit back to another site', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app))
        .post('/posts')
        .set({ ...X, Host: 'app.test', Referer: 'https://evil.example/phish' })
        .send({})
        .expect(303)
      expect(res.headers.location).toBe('/')
    })

    it('treats a protocol-relative stored URL as another site', () => {
      const session = { data: { __inertia_previous: '//evil.example/x' } }
      expect(previousUrl(session, {})).toBe('/')
      expect(previousUrl({ data: { __inertia_previous: '/\\evil.example' } }, {})).toBe('/')
      expect(previousUrl({ data: { __inertia_previous: '/posts?page=2' } }, {})).toBe(
        '/posts?page=2',
      )
    })

    it('scopes errors to the error bag the client names', async () => {
      const app = await makeApp()
      const agent = request.agent(app.handle.bind(app))
      await agent
        .post('/posts')
        .set({ ...X, 'X-Inertia-Error-Bag': 'createPost' })
        .send({})
        .expect(303)
      const next = await agent.get('/posts').set(X).expect(200)
      expect(next.body.props.errors).toEqual({ createPost: { title: 'Title is required' } })
    })

    it('carries flash data to the next page', async () => {
      const app = await makeApp()
      const agent = request.agent(app.handle.bind(app))
      const res = await agent.post('/posts').set(X).send({ title: 'Hi' }).expect(303)
      expect(res.headers.location).toBe('/posts')

      const next = await agent.get('/posts').set(X).expect(200)
      expect(next.body.flash).toEqual({ success: 'Created' })
      const again = await agent.get('/posts').set(X).expect(200)
      expect(again.body.flash).toEqual({})
    })

    it('keeps the plain 422 for requests that are not Inertia visits', async () => {
      const app = await makeApp()
      await request(app.handle.bind(app)).post('/posts').send({}).expect(422)
    })

    it('sends an external visit as 409 + X-Inertia-Location', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/away').set(X).expect(409)
      expect(res.headers['x-inertia-location']).toBe('https://example.com/out')
      await request(app.handle.bind(app)).get('/away').expect(302)
    })

    it('server-renders the page through the SSR bundle', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'kick-inertia-ssr-'))
      const bundle = join(dir, 'ssr.mjs')
      writeFileSync(
        bundle,
        `export default async (page) => ({
        head: ['<title inertia>' + page.component + '</title>'],
        body: '<div data-server-rendered="true" id="app"><h1>' + page.props.users.length + ' users</h1></div>',
      })`,
      )
      const app = await makeApp({ ssrBundle: bundle })
      const res = await request(app.handle.bind(app)).get('/users').expect(200)
      expect(res.text).toContain('<title inertia>Users/Index</title>')
      expect(res.text).toContain('<div data-server-rendered="true" id="app"><h1>1 users</h1></div>')
      expect(res.text).toContain('<script type="module" src="/assets/main-abc.js"></script>')

      // Inertia visits are JSON; SSR only shapes the first HTML response.
      const json = await request(app.handle.bind(app)).get('/users').set(X).expect(200)
      expect(json.body.component).toBe('Users/Index')
    })

    it('falls back to client rendering when the SSR bundle throws', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'kick-inertia-ssr-'))
      const bundle = join(dir, 'ssr.mjs')
      writeFileSync(bundle, `export default async () => { throw new Error('boom') }`)
      const app = await makeApp({ ssrBundle: bundle })
      const res = await request(app.handle.bind(app)).get('/users').expect(200)
      expect(res.text).toContain('<script data-page="app" type="application/json">')
      expect(res.text).toContain('<div id="app"></div>')
    })

    it('serves the built assets and public files, but not the manifest', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/assets/main-abc.js').expect(200)
      expect(res.text).toBe('console.log(1)')
      const robots = await request(app.handle.bind(app)).get('/robots.txt').expect(200)
      expect(robots.text).toBe('User-agent: *')
      await request(app.handle.bind(app)).get('/.vite/manifest.json').expect(404)
      await request(app.handle.bind(app)).get('/%2evite/manifest.json').expect(404)
    })

    it('refuses a clientDir that is a project root', async () => {
      const dir = clientBuild()
      writeFileSync(join(dir, 'package.json'), '{}')
      const app = new Application({ modules: [], adapters: [InertiaAdapter({ clientDir: dir })] })
      await expect(app.setup()).rejects.toThrow(/looks like a project root/)
    })

    it('adds the head option to every page', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/users').expect(200)
      expect(res.text).toContain('<link rel="icon" href="/favicon.svg" />')
    })

    describe('error pages', () => {
      const html = { Accept: 'text/html' }
      const pageOf = (text: string) =>
        JSON.parse(
          /<script data-page="app" type="application\/json">(.*?)<\/script>/.exec(text)![1],
        )

      it('renders the error page for an unknown URL a browser asks for', async () => {
        const app = await makeApp({ errorPage: 'Error' })
        const res = await request(app.handle.bind(app)).get('/nowhere').set(html).expect(404)
        const page = pageOf(res.text)
        expect(page.component).toBe('Error')
        expect(page.props).toMatchObject({
          status: 404,
          message: 'Page Not Found',
          appName: 'Kick',
        })
      })

      it('answers an Inertia visit to an unknown URL with the error page as JSON', async () => {
        const app = await makeApp({ errorPage: 'Error' })
        const res = await request(app.handle.bind(app)).get('/nowhere').set(X).expect(404)
        expect(res.headers['x-inertia']).toBe('true')
        expect(res.body.component).toBe('Error')
      })

      it('leaves API calls and non-GET requests to the default 404', async () => {
        const app = await makeApp({ errorPage: 'Error' })
        const api = await request(app.handle.bind(app))
          .get('/nowhere')
          .set({ Accept: 'application/json' })
          .expect(404)
        expect(api.headers['content-type']).toMatch(/json/)
        await request(app.handle.bind(app)).post('/nowhere').set(html).expect(404)
      })

      it('renders thrown errors with their status, and hides a 5xx message in production', async () => {
        const app = await makeApp({ errorPage: 'Error' })
        const forbidden = await request(app.handle.bind(app)).get('/secret').set(html).expect(403)
        expect(pageOf(forbidden.text).props).toMatchObject({ status: 403, message: 'Members only' })

        const dev = await request(app.handle.bind(app)).get('/boom').set(X).expect(500)
        expect(dev.body.props).toMatchObject({ status: 500, message: 'database is down' })

        const env = process.env.NODE_ENV
        process.env.NODE_ENV = 'production'
        try {
          const prod = await request(app.handle.bind(app)).get('/boom').set(X).expect(500)
          expect(prod.body.props).toMatchObject({ status: 500, message: 'Server Error' })
        } finally {
          process.env.NODE_ENV = env
        }
      })

      it('keeps the default answers when no error page is configured', async () => {
        const app = await makeApp()
        const res = await request(app.handle.bind(app)).get('/nowhere').set(html).expect(404)
        expect(res.headers['content-type']).toMatch(/json/)
      })
    })

    describe('once props', () => {
      it('lists them, and skips the ones the client already holds', async () => {
        const app = await makeApp()
        const first = await request(app.handle.bind(app)).get('/feed').set(X).expect(200)
        expect(first.body.props.plans).toEqual(['free', 'pro'])
        expect(first.body.onceProps.geo).toEqual({ prop: 'countries' })
        expect(first.body.onceProps.plans.prop).toBe('plans')
        expect(first.body.onceProps.plans.expiresAt).toBeGreaterThan(Date.now())

        const cached = await request(app.handle.bind(app))
          .get('/feed')
          .set({ ...X, 'X-Inertia-Except-Once-Props': 'plans,geo' })
          .expect(200)
        expect(cached.body.props).not.toHaveProperty('plans')
        expect(cached.body.props).not.toHaveProperty('countries')
        // Still listed, so the client fills them in from its cache.
        expect(Object.keys(cached.body.onceProps)).toEqual(['plans', 'geo'])
      })

      it('sends a cached once prop a partial reload names', async () => {
        const app = await makeApp()
        const res = await request(app.handle.bind(app))
          .get('/feed')
          .set({
            ...X,
            'X-Inertia-Partial-Component': 'Feed',
            'X-Inertia-Partial-Data': 'plans',
            'X-Inertia-Except-Once-Props': 'plans',
          })
          .expect(200)
        expect(res.body.props.plans).toEqual(['free', 'pro'])
      })
    })

    describe('infinite scroll', () => {
      it('describes the page and merges the rows under data', async () => {
        const app = await makeApp()
        const res = await request(app.handle.bind(app)).get('/feed?page=2').set(X).expect(200)
        expect(res.body.scrollProps.posts).toEqual({
          pageName: 'page',
          currentPage: 2,
          nextPage: 3,
          previousPage: 1,
          reset: false,
        })
        expect(res.body.mergeProps).toEqual(['posts.data', 'tags'])
        expect(res.body.matchPropsOn).toEqual(['posts.data.id', 'tags.slug'])
      })

      it('prepends when the client loads the previous page, and stops merging on reset', async () => {
        const app = await makeApp()
        const prev = await request(app.handle.bind(app))
          .get('/feed?page=1')
          .set({ ...X, 'X-Inertia-Infinite-Scroll-Merge-Intent': 'prepend' })
          .expect(200)
        expect(prev.body.prependProps).toEqual(['posts.data'])
        expect(prev.body.scrollProps.posts.previousPage).toBeNull()

        const reset = await request(app.handle.bind(app))
          .get('/feed')
          .set({ ...X, 'X-Inertia-Reset': 'posts' })
          .expect(200)
        expect(reset.body.scrollProps.posts.reset).toBe(true)
        expect(reset.body.mergeProps).toEqual(['tags'])
      })
    })

    describe('fragments', () => {
      it('sends an Inertia visit to a URL with a fragment as 409 + X-Inertia-Redirect', async () => {
        const app = await makeApp()
        const res = await request(app.handle.bind(app)).post('/comments').set(X).expect(409)
        expect(res.headers['x-inertia-redirect']).toBe('/posts/1#comments')

        const plain = await request(app.handle.bind(app)).post('/comments').expect(303)
        expect(plain.headers.location).toBe('/posts/1#comments')
      })

      it('tells the next page to keep the fragment', async () => {
        const app = await makeApp()
        const agent = request.agent(app.handle.bind(app))
        await agent.post('/keep').set(X).expect(303)
        const next = await agent.get('/posts').set(X).expect(200)
        expect(next.body.preserveFragment).toBe(true)
        const again = await agent.get('/posts').set(X).expect(200)
        expect(again.body).not.toHaveProperty('preserveFragment')
      })
    })

    describe('precognition', () => {
      const P = { Precognition: 'true', Accept: 'application/json' }

      it('validates without running the handler', async () => {
        const app = await makeApp()
        const res = await request(app.handle.bind(app))
          .post('/users')
          .set(P)
          .send({ title: 'Ada' })
          .expect(204)
        expect(res.headers.precognition).toBe('true')
        expect(res.headers['precognition-success']).toBe('true')
      })

      it('answers 422 with the errors of the fields it asked about', async () => {
        const app = await makeApp()
        const res = await request(app.handle.bind(app))
          .post('/users')
          .set({ ...P, 'Precognition-Validate-Only': 'title' })
          .send({ title: '' })
          .expect(422)
        expect(res.headers.precognition).toBe('true')
        expect(res.body.errors).toEqual({ title: 'Title is required' })
      })

      it('succeeds when only fields it did not ask about fail', async () => {
        const app = await makeApp()
        const res = await request(app.handle.bind(app))
          .post('/users')
          .set({ ...P, 'Precognition-Validate-Only': 'email' })
          .send({ title: '' })
          .expect(204)
        expect(res.headers['precognition-success']).toBe('true')
      })

      it('runs the handler for an ordinary submit', async () => {
        const app = await makeApp()
        await request(app.handle.bind(app)).post('/users').set(X).send({ title: 'Ada' }).expect(303)
      })
    })
  })
