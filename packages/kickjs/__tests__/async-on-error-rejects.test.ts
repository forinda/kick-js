import 'reflect-metadata'
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Application } from '../src/http/application'
import { Container } from '../src/core/container'
import { Controller, Get } from '../src/core/decorators'
import { expressRuntime } from '../src/http/runtimes/express'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import type { HttpRuntime } from '../src/http/runtime'

/** An async onError that itself fails must still end the request. */
const RUNTIMES: Array<{ name: string; make: () => HttpRuntime }> = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
]

beforeEach(() => Container.reset())

for (const rt of RUNTIMES) {
  describe(`async onError that rejects — ${rt.name}`, () => {
    it('answers 500 instead of leaving the request open', async () => {
      @Controller()
      class FailController {
        @Get('/')
        fail() {
          throw new Error('boom')
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/fail', controller: FailController }) } as never],
        onError: async () => {
          await Promise.resolve()
          throw new Error('the error handler failed too')
        },
      })
      await app.setup()
      const res = await request(app.handle.bind(app)).get('/api/v1/fail').timeout(3000)
      expect(res.status).toBe(500)
    })
  })
}
