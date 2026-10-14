import 'reflect-metadata'
import request from 'supertest'
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import {
  Application,
  Container,
  Controller,
  Get,
  Post,
  expressRuntime,
  type RequestContext,
} from '../src/index'

// What `kick typegen` writes for the controller below.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace KickRoutes {
    interface Named {
      'UrlUsersController.show': {
        params: { id: string }
        body: unknown
        query: unknown
        response: unknown
      }
      'UrlUsersController.create': { params: {}; body: unknown; query: unknown; response: unknown }
    }
  }
}

@Controller()
class UrlUsersController {
  @Get('/:id')
  show(ctx: RequestContext) {
    ctx.json({ id: ctx.params.id })
  }

  @Post('/')
  create(ctx: RequestContext) {
    ctx.setHeader('Location', ctx.urlFor('UrlUsersController.show', { id: 'a b' }))
    ctx.created({ ok: true })
  }
}

const RUNTIMES = [
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

for (const [name, runtime] of RUNTIMES)
  describe(`urlFor — ${name}`, () => {
    beforeEach(() => Container.reset())

    it('builds the full path from the route name, prefix and version included', async () => {
      const app = new Application({
        runtime: runtime(),
        modules: [{ routes: () => ({ path: '/users', controller: UrlUsersController }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app)).post('/api/v1/users').send({}).expect(201)
      expect(res.headers.location).toBe('/api/v1/users/a%20b')

      expect(app.urlFor('UrlUsersController.create')).toBe('/api/v1/users')
      expect(
        app.urlFor('UrlUsersController.show', { id: '7' }, { tab: 'posts', tag: ['a', 'b'] }),
      ).toBe('/api/v1/users/7?tab=posts&tag=a&tag=b')
    })
  })

describe('urlFor errors and types', () => {
  beforeEach(() => Container.reset())

  it('throws on an unknown name or a missing param', async () => {
    const app = new Application({
      modules: [{ routes: () => ({ path: '/users', controller: UrlUsersController }) } as never],
    })
    await app.setup()
    expect(() => app.urlFor('Nope.nothing' as 'UrlUsersController.create')).toThrow(
      /no route named 'Nope.nothing'/,
    )
    expect(() => app.urlFor('UrlUsersController.show', {} as never)).toThrow(/missing param 'id'/)
  })

  it('types names and params from KickRoutes.Named', () => {
    const app = {} as Application
    expectTypeOf(app.urlFor)
      .parameter(0)
      .toEqualTypeOf<'UrlUsersController.show' | 'UrlUsersController.create'>()
    // @ts-expect-error — `show` needs { id }
    void (() => app.urlFor('UrlUsersController.show'))
    // @ts-expect-error — not a route name
    void (() => app.urlFor('UrlUsersController.missing'))
    void (() => app.urlFor('UrlUsersController.create'))
  })
})
