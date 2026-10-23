/**
 * A store-backed session is saved before the response goes out: the redirect
 * after a form post can come straight back and must see what was flashed.
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
  type SessionStore,
} from '../src/index'

/** A store like Redis: every write takes a while. */
function slowStore(ms: number): SessionStore {
  const data = new Map<string, Record<string, unknown>>()
  return {
    get: async (id) => data.get(id) ?? null,
    set: (id, value) =>
      new Promise((done) =>
        setTimeout(() => {
          data.set(id, structuredClone(value))
          done()
        }, ms),
      ),
    destroy: async (id) => {
      data.delete(id)
    },
  }
}

@Controller()
class FlashController {
  @Post('/save')
  save(ctx: RequestContext) {
    ctx.session.data.msg = 'saved'
    ctx.redirect('/read', 303)
  }

  @Get('/read')
  read(ctx: RequestContext) {
    ctx.json({ msg: ctx.session.data.msg ?? null })
  }
}

for (const [name, runtime] of [
  ['express', expressRuntime],
  ['fastify', fastifyRuntime],
  ['h3', h3Runtime],
] as const)
  describe(`session save timing — ${name}`, () => {
    beforeEach(() => Container.reset())

    it('the request after the response sees what it wrote', async () => {
      const app = new Application({
        runtime: runtime(),
        middlewares: [session({ secret: 'x'.repeat(32), store: slowStore(50) })],
        modules: [
          {
            routes: () => ({
              path: '/',
              prefix: false,
              version: false,
              controller: FlashController,
            }),
          } as never,
        ],
      })
      await app.setup()
      const http = request.agent(app.handle.bind(app))
      await http.post('/save').expect(303)
      // Straight away, as a browser following the redirect would.
      expect((await http.get('/read').expect(200)).body).toEqual({ msg: 'saved' })
    })

    it('a store that fails still lets the response go out', async () => {
      const failing: SessionStore = {
        get: async () => null,
        set: async () => {
          throw new Error('store down')
        },
        destroy: async () => {},
      }
      const app = new Application({
        runtime: runtime(),
        middlewares: [session({ secret: 'x'.repeat(32), store: failing })],
        modules: [
          {
            routes: () => ({
              path: '/',
              prefix: false,
              version: false,
              controller: FlashController,
            }),
          } as never,
        ],
      })
      await app.setup()
      await request(app.handle.bind(app)).post('/save').expect(303)
    })
  })
