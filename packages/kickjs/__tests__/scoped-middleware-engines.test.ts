import 'reflect-metadata'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import * as h3v2 from 'h3-v2'
import { Application } from '../src/http/application'
import { Container } from '../src/core/container'
import { Controller, Get } from '../src/core/decorators'
import { defineRouteFlag } from '../src/core/route-flag'
import { rateLimit } from '../src/http/middleware/rate-limit'
import { expressRuntime } from '../src/http/runtimes/express'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import { h3WebRuntime } from '../src/http/runtimes/h3-web'
import type { HttpRuntime } from '../src/http/runtime'
import type { AppAdapter } from '../src/core'

/**
 * A middleware or static directory mounted at a path covers everything under
 * it, on every engine — h3 v2's own `use('/p')` matches `/p` alone.
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
  describe(`path-scoped middleware and static files — ${rt.name}`, () => {
    async function makeApp() {
      @Controller()
      class ItemsController {
        @Get('/')
        list() {
          return { items: [] }
        }
        @Get('/:id/detail')
        detail() {
          return { item: 1 }
        }
      }
      const dir = mkdtempSync(join(tmpdir(), 'kick-static-'))
      mkdirSync(join(dir, 'nested'))
      writeFileSync(join(dir, 'nested', 'a.txt'), 'deep file')
      const staticAdapter: AppAdapter = {
        name: 'StaticAdapter',
        beforeMount({ http }) {
          http.serveStatic('/files', dir)
        },
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/items', controller: ItemsController }) } as never],
        middlewares: [
          {
            path: '/api/v1/items',
            handler: (
              _req: unknown,
              res: { setHeader(n: string, v: string): void },
              next: () => void,
            ) => {
              res.setHeader('x-scoped', 'yes')
              next()
            },
          },
        ] as never,
        adapters: [staticAdapter],
      })
      await app.setup()
      return app
    }

    it('runs a path-scoped middleware on the path and everything under it', async () => {
      const app = await makeApp()
      const base = await request(app.handle.bind(app)).get('/api/v1/items').expect(200)
      expect(base.headers['x-scoped']).toBe('yes')
      const deep = await request(app.handle.bind(app)).get('/api/v1/items/7/detail').expect(200)
      expect(deep.headers['x-scoped']).toBe('yes')
    })

    it('does not run it elsewhere', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/other')
      expect(res.headers['x-scoped']).toBeUndefined()
    })

    it('serves nested files under a static prefix', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/files/nested/a.txt').expect(200)
      expect(res.text).toBe('deep file')
    })

    it('a mounted rateLimit finds the route by its full path for exemptWhen', async () => {
      const Open = defineRouteFlag('test.open')
      @Controller()
      class HealthController {
        @Open
        @Get('/')
        health() {
          return { ok: true }
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/health', controller: HealthController }) } as never],
        middlewares: [
          { path: '/api', handler: rateLimit({ max: 1, exemptWhen: 'test.open' }) },
        ] as never,
      })
      await app.setup()
      const h = app.handle.bind(app)
      const statuses = [
        (await request(h).get('/api/v1/health')).status,
        (await request(h).get('/api/v1/health')).status,
      ]
      expect(statuses).toEqual([200, 200])
    })
  })
}
