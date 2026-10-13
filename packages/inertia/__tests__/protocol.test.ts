import 'reflect-metadata'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  Application,
  Container,
  Controller,
  Get,
  Post,
  Put,
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
  location,
  merge,
  optional,
  redirect,
} from '@forinda/kickjs-inertia'

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

async function makeApp(options: { version?: string | null } = {}) {
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

    @Get('/away')
    away() {
      return location('https://example.com/out')
    }
  }

  const app = new Application({
    modules: [
      {
        routes: () => ({ path: '/', prefix: false, version: false, controller: PagesController }),
      } as never,
    ],
    middlewares: [express.json(), session({ secret: 'test-secret-test-secret' })],
    adapters: [
      InertiaAdapter({
        clientDir: clientBuild(),
        ...(options.version === null ? {} : { version: options.version ?? 'v1' }),
        share: () => ({ appName: 'Kick' }),
      }),
    ],
    onError: inertiaErrorHandler(),
  })
  await app.setup()
  return app
}

const X = { 'X-Inertia': 'true', 'X-Inertia-Version': 'v1' }

describe('InertiaAdapter', () => {
  beforeEach(() => Container.reset())

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
    expect(res.headers.vary).toMatch(/X-Inertia/)
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
      .set({ ...X, Referer: '/posts/new' })
      .send({ title: '' })
      .expect(303)
    expect(res.headers.location).toBe('/posts/new')

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

  it('serves the built assets', async () => {
    const app = await makeApp()
    const res = await request(app.handle.bind(app)).get('/assets/main-abc.js').expect(200)
    expect(res.text).toBe('console.log(1)')
  })
})
