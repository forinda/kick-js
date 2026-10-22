import 'reflect-metadata'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { Application, Container, Controller, Get, type RequestContext } from '../src/index'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { bindViewRenderer, viewRendererFor } from '../src/http/view-renderer'

@Controller()
class C {
  @Get('/x')
  async x(ctx: RequestContext) {
    await ctx.render('x')
  }
}

describe('view renderer slot', () => {
  it('binds and reads a renderer on a request', () => {
    const req = {}
    const r = async () => 'html'
    bindViewRenderer(req, r)
    expect(viewRendererFor(req)).toBe(r)
    expect(viewRendererFor({})).toBeUndefined()
  })

  it('without a renderer, Fastify keeps its message', async () => {
    Container.reset()
    const app = new Application({
      runtime: fastifyRuntime() as never,
      modules: [
        class {
          routes() {
            return { path: '/', prefix: false, version: false, controller: C }
          }
        } as never,
      ],
    })
    await app.setup()
    const res = await request(app.handle.bind(app)).get('/x').expect(500)
    expect(res.text).toContain('not supported on the Fastify runtime')
  })
})
