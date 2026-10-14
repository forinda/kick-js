/**
 * `session({ store: 'cookie' })`: the session lives in an encrypted cookie,
 * so any instance reads it — a fresh app per request stands in for a
 * serverless function landing on a new instance each time.
 */
import 'reflect-metadata'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import {
  Application,
  Container,
  Controller,
  Get,
  Post,
  expressRuntime,
  session,
  type RequestContext,
} from '../src/index'

const SECRET = 'cookie-session-secret-cookie-session-secret'

const RUNTIMES = [
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

/** A new app — no memory shared with the previous one. */
async function instance(
  runtime: () => any,
  extra: Parameters<typeof session>[0] = { secret: SECRET },
) {
  Container.reset()
  @Controller()
  class C {
    @Post('/login')
    async login(ctx: RequestContext) {
      ctx.session.data.userId = 'u1'
      ctx.session.data.cart = []
      ctx.json({ ok: true })
    }
    @Post('/add')
    add(ctx: RequestContext) {
      // Nested change, no save(): written when the headers go out.
      ;(ctx.session.data.cart as string[]).push('apple')
      ctx.json({ ok: true })
    }
    @Get('/me')
    me(ctx: RequestContext) {
      ctx.json({ userId: ctx.session.data.userId ?? null, cart: ctx.session.data.cart ?? null })
    }
    @Post('/logout')
    async logout(ctx: RequestContext) {
      await ctx.session.destroy()
      ctx.json({ ok: true })
    }
  }
  const app = new Application({
    runtime: runtime(),
    modules: [
      { routes: () => ({ path: '/', prefix: false, version: false, controller: C }) } as never,
    ],
    middlewares: [session({ store: 'cookie', cookie: { secure: false }, ...extra })],
  })
  await app.setup()
  return request(app.handle.bind(app))
}

const cookieOf = (res: request.Response) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('kick.sid='))

for (const [name, runtime] of RUNTIMES)
  describe(`session({ store: 'cookie' }) — ${name}`, () => {
    beforeEach(() => Container.reset())

    it('carries the session between instances in the cookie', async () => {
      const login = await (await instance(runtime)).post('/login').expect(200)
      const cookie = cookieOf(login)!
      expect(cookie).toMatch(/^kick\.sid=v1\./)
      expect(cookie).toContain('HttpOnly')
      // Encrypted: the decoded bytes hold none of the session's plaintext.
      // (Checked on the bytes: the base64 text of random ciphertext can
      // contain any short string by chance.)
      const sealed = Buffer.from(
        decodeURIComponent(cookie.split(';')[0]!).slice('kick.sid=v1.'.length),
        'base64url',
      )
      expect(sealed.toString('latin1')).not.toContain('userId')

      const jar = cookie.split(';')[0]!
      const added = await (await instance(runtime)).post('/add').set('Cookie', jar).expect(200)
      const jar2 = cookieOf(added)!.split(';')[0]!

      const me = await (await instance(runtime)).get('/me').set('Cookie', jar2).expect(200)
      expect(me.body).toEqual({ userId: 'u1', cart: ['apple'] })
      // Nothing changed: the browser's cookie is left as it is.
      expect(cookieOf(me)).toBeUndefined()
    })

    it('rotates the secret without dropping sessions', async () => {
      const login = await (
        await instance(runtime, { secret: 'old-secret-old-secret' })
      )
        .post('/login')
        .expect(200)
      const oldJar = cookieOf(login)!.split(';')[0]!

      const rotated = { secret: ['new-secret-new-secret', 'old-secret-old-secret'] }
      const me = await (
        await instance(runtime, rotated)
      )
        .get('/me')
        .set('Cookie', oldJar)
        .expect(200)
      expect(me.body.userId).toBe('u1')
      // Re-sealed with the new secret, though nothing changed.
      const newJar = cookieOf(me)!.split(';')[0]!
      expect(newJar).not.toBe(oldJar)

      // The new secret alone now reads it; the old cookie no longer works.
      const onlyNew = { secret: 'new-secret-new-secret' }
      const again = await (await instance(runtime, onlyNew)).get('/me').set('Cookie', newJar)
      expect(again.body.userId).toBe('u1')
      const stale = await (await instance(runtime, onlyNew)).get('/me').set('Cookie', oldJar)
      expect(stale.body.userId).toBeNull()
    })

    it('starts a fresh session for a cookie it did not write', async () => {
      const login = await (await instance(runtime)).post('/login').expect(200)
      const jar = cookieOf(login)!.split(';')[0]!
      const tampered = jar.slice(0, -4) + (jar.endsWith('AAAA') ? 'BBBB' : 'AAAA')
      const me = await (await instance(runtime)).get('/me').set('Cookie', tampered).expect(200)
      expect(me.body.userId).toBeNull()

      // Another secret can't read it either.
      const other = await (
        await instance(runtime, { secret: `${SECRET}-other` })
      )
        .get('/me')
        .set('Cookie', jar)
        .expect(200)
      expect(other.body.userId).toBeNull()
    })

    it('honours maxAge inside the cookie, not just in the browser', async () => {
      const login = await (
        await instance(runtime, { secret: SECRET, maxAge: 1 })
      )
        .post('/login')
        .expect(200)
      const jar = cookieOf(login)!.split(';')[0]!
      await new Promise((r) => setTimeout(r, 10))
      const me = await (await instance(runtime)).get('/me').set('Cookie', jar).expect(200)
      expect(me.body.userId).toBeNull()
    })

    it('clears the cookie on destroy()', async () => {
      const login = await (await instance(runtime)).post('/login').expect(200)
      const jar = cookieOf(login)!.split(';')[0]!
      const out = await (await instance(runtime)).post('/logout').set('Cookie', jar).expect(200)
      expect(cookieOf(out)).toMatch(/^kick\.sid=;.*Max-Age=0/)
    })
  })

describe(`session({ store: 'cookie' }) — web fetch path`, () => {
  it('writes the cookie on the buffered web response too', async () => {
    Container.reset()
    @Controller()
    class W {
      @Post('/login')
      login(ctx: RequestContext) {
        ctx.session.data.userId = 'w1'
        ctx.json({ ok: true })
      }
      @Get('/me')
      me(ctx: RequestContext) {
        ctx.json({ userId: ctx.session.data.userId ?? null })
      }
    }
    const make = async () => {
      Container.reset()
      const app = new Application({
        runtime: h3Runtime(),
        modules: [
          { routes: () => ({ path: '/', prefix: false, version: false, controller: W }) } as never,
        ],
        middlewares: [session({ secret: SECRET, store: 'cookie', cookie: { secure: false } })],
      })
      await app.setup()
      return app
    }
    const login = await (await make()).fetch(new Request('http://x/login', { method: 'POST' }))
    const cookie = login.headers.getSetCookie().find((c) => c.startsWith('kick.sid='))!
    expect(cookie).toMatch(/^kick\.sid=v1\./)
    const me = await (
      await make()
    ).fetch(new Request('http://x/me', { headers: { cookie: cookie.split(';')[0]! } }))
    expect(await me.json()).toEqual({ userId: 'w1' })
  })
})
