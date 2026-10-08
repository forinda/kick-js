/**
 * `createTestApp(...).client()`: requests through whichever runtime the app
 * runs on, with headers, a bearer token and a base path set once, and
 * cookies kept when asked. Plus `onTestReset` / `resetTestState` and the
 * `runContributor` ctx and env seeds.
 */
import { describe, expect, it } from 'vitest'
import {
  Controller,
  Get,
  defineContextDecorator,
  expressRuntime,
  getEnv,
  session,
  type RequestContext,
} from '@forinda/kickjs'
import { fastifyRuntime } from '../../kickjs/src/http/runtimes/fastify'
import { h3Runtime } from '../../kickjs/src/http/runtimes/h3'
import {
  createTestApp,
  createTestModule,
  onTestReset,
  resetTestState,
  runContributor,
} from '../src/index'

@Controller()
class EchoController {
  @Get('/headers')
  headers(ctx: RequestContext) {
    return {
      host: ctx.headers.host,
      auth: ctx.headers.authorization ?? null,
      tenant: ctx.headers['x-tenant'] ?? null,
      cookie: ctx.headers.cookie ?? null,
      key: ctx.headers['x-api-key'] ?? null,
    }
  }

  @Get('/visit')
  visit(ctx: RequestContext) {
    const count = ((ctx.session.data.count as number | undefined) ?? 0) + 1
    ctx.session.data.count = count
    return { count }
  }
}

const EchoModule = createTestModule({
  register: () => {},
  routes: () => ({ path: '/echo', controller: EchoController }),
})

const runtimes = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
] as const

describe.each(runtimes)('client() on $name', ({ make }) => {
  it('sends the headers, the bearer token and the base path it was given', async () => {
    const { client } = await createTestApp({
      modules: [EchoModule],
      runtime: make(),
      isolated: true,
    })
    const api = client({ headers: { host: 'acme.localhost' }, basePath: '/api/v1/' })

    const plain = await api.get('/echo/headers').expect(200)
    expect(plain.body).toMatchObject({ host: 'acme.localhost', auth: null, tenant: null })

    const signedIn = await api.as('tok-1').withHeaders({ 'x-tenant': 't1' }).get('/echo/headers')
    expect(signedIn.body).toMatchObject({
      host: 'acme.localhost',
      auth: 'Bearer tok-1',
      tenant: 't1',
    })

    // Scoping returns a new client; the original is unchanged.
    expect((await api.get('/echo/headers')).body.auth).toBeNull()

    // An explicit Authorization replaces an inherited bearer; names are case-insensitive.
    const asOne = client({ bearer: 'one', basePath: '/api/v1' })
    expect(
      (await asOne.withHeaders({ Authorization: 'Bearer two' }).get('/echo/headers')).body.auth,
    ).toBe('Bearer two')
    expect((await asOne.as('three').get('/echo/headers')).body.auth).toBe('Bearer three')
  })

  it("authenticates .as() the app's way when given auth, not only by bearer", async () => {
    const { client } = await createTestApp({
      modules: [EchoModule],
      runtime: make(),
      isolated: true,
    })
    const bySession = client({ basePath: '/api/v1', auth: (sid) => ({ cookie: `sid=${sid}` }) })
    expect((await bySession.as('s-1').get('/echo/headers')).body).toMatchObject({
      auth: null,
      cookie: 'sid=s-1',
    })
    const byKey = client({ basePath: '/api/v1', auth: (key) => ({ 'X-Api-Key': key }) })
    const keyed = await byKey.as('k-1').withHeaders({ 'x-tenant': 't1' }).get('/echo/headers')
    expect(keyed.body).toMatchObject({ auth: null, key: 'k-1', tenant: 't1' })
    // A second .as() replaces the first.
    expect((await byKey.as('k-1').as('k-2').get('/echo/headers')).body.key).toBe('k-2')
  })

  it('keeps cookies between requests when asked, and not otherwise', async () => {
    const { client } = await createTestApp({
      modules: [EchoModule],
      runtime: make(),
      middlewares: [session({ secret: 'test-secret-value' })] as never,
      isolated: true,
    })
    const browser = client({ cookies: true, basePath: '/api/v1' })
    await browser.get('/echo/visit')
    expect((await browser.get('/echo/visit')).body).toEqual({ count: 2 })
    // A client scoped from a cookie client shares its cookie jar.
    expect((await browser.as('tok').get('/echo/visit')).body).toEqual({ count: 3 })
    expect((await browser.withHeaders({ 'x-a': '1' }).get('/echo/visit')).body).toEqual({
      count: 4,
    })

    const fresh = client({ basePath: '/api/v1' })
    await fresh.get('/echo/visit')
    expect((await fresh.get('/echo/visit')).body).toEqual({ count: 1 })
  })
})

describe('onTestReset', () => {
  it('runs every reset in order, even after one throws, and can unregister', async () => {
    const ran: string[] = []
    const offA = onTestReset(() => ran.push('a'))
    const offB = onTestReset(() => {
      ran.push('b')
      throw new Error('b failed')
    })
    const offC = onTestReset(async () => {
      ran.push('c')
    })
    await expect(resetTestState()).rejects.toThrow('b failed')
    expect(ran).toEqual(['a', 'b', 'c'])

    offB()
    ran.length = 0
    await resetTestState()
    expect(ran).toEqual(['a', 'c'])
    offA()
    offC()
  })
})

describe('runContributor ctx and env', () => {
  it('seeds the request and the env the resolver reads, then restores the env', async () => {
    const TenantFromHost = defineContextDecorator({
      key: 'tenantSlug',
      resolve: (ctx) => {
        const host = (ctx as unknown as { req: { headers: { host: string } } }).req.headers.host
        const trusted = getEnv('TRUST_PROXY' as never) === true
        return `${host.split('.')[0]}:${trusted ? 'proxied' : 'direct'}`
      },
    })
    const { value } = await runContributor(TenantFromHost, {
      ctx: { req: { headers: { host: 'acme.example.com' } } },
      env: { TRUST_PROXY: true },
    })
    expect(value).toBe('acme:proxied')
    expect(getEnv('TRUST_PROXY' as never)).toBeUndefined()
  })
})
