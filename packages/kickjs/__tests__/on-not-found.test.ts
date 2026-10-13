import 'reflect-metadata'
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Application } from '../src/http/application'
import { Container } from '../src/core/container'
import { Controller, Get, Post } from '../src/core/decorators'
import { expressRuntime } from '../src/http/runtimes/express'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import { h3WebRuntime } from '../src/http/runtimes/h3-web'
import * as h3v2 from 'h3-v2'
import type { HttpRuntime, RuntimeResponse } from '../src/http/runtime'

/**
 * A custom `onNotFound` answers what it wants and calls `next()` for the rest,
 * which reaches the built-in handler — 404, or 405 + Allow for a path that
 * exists under another method — on every engine.
 */
const RUNTIMES: Array<{ name: string; make: () => HttpRuntime }> = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
  // h3 v2, through the npm alias — the installed `h3` peer is v1.
  { name: 'h3-web', make: () => h3WebRuntime({ h3: h3v2 }) },
]

beforeEach(() => Container.reset())

for (const rt of RUNTIMES) {
  describe(`onNotFound — ${rt.name}`, () => {
    async function makeApp() {
      @Controller()
      class ItemsController {
        @Post('/')
        create() {
          return { ok: true }
        }

        @Get('/fail')
        fail() {
          throw new Error('boom')
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/items', controller: ItemsController }) } as never],
        onNotFound: (req: { url?: string }, res: RuntimeResponse, next) => {
          if (req.url?.startsWith('/pages/')) {
            res.status(404).type('text/html; charset=utf-8').send('<h1>No such page</h1>')
            return
          }
          next()
        },
        // Answers after an await — the engine must wait for it, not send its
        // own error response first.
        onError: async (_err: unknown, _req: unknown, res: RuntimeResponse) => {
          await new Promise((r) => setTimeout(r, 10))
          res.status(503).type('text/plain; charset=utf-8').send('async answer')
        },
      })
      await app.setup()
      return app
    }

    it('answers the requests it handles', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/pages/missing').expect(404)
      expect(res.text).toBe('<h1>No such page</h1>')
    })

    it('hands the rest to the built-in 404', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/nothing').expect(404)
      expect(res.headers['content-type']).toMatch(/problem\+json/)
    })

    it('waits for an onError that answers asynchronously', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/items/fail').expect(503)
      expect(res.text).toBe('async answer')
    })

    it('keeps the built-in 405 + Allow for a path under another method', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/items').expect(405)
      expect(res.headers.allow).toBe('POST')
    })
  })
}

/**
 * Mounted inside a host handler (as `kick dev` mounts it in Vite), Fastify and
 * h3 hand unmatched requests back by default; `notFoundFallthrough: false`
 * answers them in the app, like Express always does.
 */
for (const rt of RUNTIMES) {
  describe(`notFoundFallthrough — ${rt.name}`, () => {
    async function mounted(notFoundFallthrough?: boolean) {
      @Controller()
      class PingController {
        @Get('/')
        ping() {
          return { pong: true }
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/ping', controller: PingController }) } as never],
        notFoundFallthrough,
      })
      await app.setup()
      // The host: whatever the app hands back answers 418.
      return (req: any, res: any) =>
        app.handle(req, res, () => {
          res.statusCode = 418
          res.end('host')
        })
    }

    it(`${rt.name === 'express' ? 'answers' : 'hands back'} unmatched requests by default`, async () => {
      const res = await request(await mounted()).get('/nope')
      expect(res.status).toBe(rt.name === 'express' ? 404 : 418)
    })

    it('answers unmatched requests with notFoundFallthrough: false', async () => {
      const res = await request(await mounted(false))
        .get('/nope')
        .expect(404)
      expect(res.headers['content-type']).toMatch(/problem\+json/)
    })

    it('still routes matched requests', async () => {
      await request(await mounted(false))
        .get('/api/v1/ping')
        .expect(200)
    })
  })
}
