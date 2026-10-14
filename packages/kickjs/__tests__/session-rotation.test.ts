import 'reflect-metadata'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  Application,
  Container,
  Controller,
  Get,
  Post,
  session,
  type RequestContext,
  type SessionStore,
} from '../src/index'

/** One store shared by every instance, as Redis would be. */
const shared = new Map<string, Record<string, unknown>>()
const store: SessionStore = {
  get: async (id) => shared.get(id) ?? null,
  set: async (id, data) => void shared.set(id, data),
  destroy: async (id) => void shared.delete(id),
}

async function instance(secret: string | string[]) {
  Container.reset()
  @Controller()
  class C {
    @Post('/login')
    login(ctx: RequestContext) {
      ctx.session.data.userId = 'u1'
      ctx.json({ ok: true })
    }
    @Get('/me')
    me(ctx: RequestContext) {
      ctx.json({ userId: ctx.session.data.userId ?? null })
    }
  }
  const app = new Application({
    modules: [
      { routes: () => ({ path: '/', prefix: false, version: false, controller: C }) } as never,
    ],
    middlewares: [session({ secret, store, cookie: { secure: false } })],
  })
  await app.setup()
  return request(app.handle.bind(app))
}

const jarOf = (res: request.Response) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? [])[0]?.split(';')[0]

describe('session secret rotation (store-backed)', () => {
  beforeEach(() => shared.clear())

  it('accepts a cookie signed with an older secret and re-signs it with the first', async () => {
    const login = await (await instance('old-secret')).post('/login').expect(200)
    const oldJar = jarOf(login)!

    const me = await (await instance(['new-secret', 'old-secret'])).get('/me').set('Cookie', oldJar)
    expect(me.body.userId).toBe('u1')
    const newJar = jarOf(me)!
    expect(newJar).not.toBe(oldJar)

    const again = await (await instance('new-secret')).get('/me').set('Cookie', newJar)
    expect(again.body.userId).toBe('u1')
  })

  it('rejects a cookie no listed secret signed', async () => {
    const login = await (await instance('someone-else')).post('/login').expect(200)
    const me = await (
      await instance(['new-secret', 'old-secret'])
    )
      .get('/me')
      .set('Cookie', jarOf(login)!)
    expect(me.body.userId).toBeNull()
  })

  it('refuses an empty secret list', () => {
    expect(() => session({ secret: [] })).toThrow(/secret/)
  })
})
