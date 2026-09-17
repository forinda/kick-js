/**
 * `ctx.sendResponse(response)` writes a web `Response` — status, headers,
 * every Set-Cookie, a streamed body — the same way on every runtime.
 */
import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import * as h3v2 from 'h3-v2'
import {
  Application,
  Container,
  Controller,
  Get,
  type AppModule,
  type ModuleRoutes,
  type RequestContext,
} from '../src/index'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import { h3WebRuntime } from '../src/http/runtimes/h3-web'

@Controller()
class WebResponseController {
  @Get('/stream')
  async stream(ctx: RequestContext) {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('chunk-1;'))
        controller.enqueue(encoder.encode('chunk-2'))
        controller.close()
      },
    })
    const headers = new Headers({ 'content-type': 'text/plain', 'x-web': 'yes' })
    headers.append('set-cookie', 'a=1; Path=/')
    headers.append('set-cookie', 'b=2; Path=/')
    await ctx.sendResponse(new Response(body, { status: 202, headers }))
  }

  @Get('/empty')
  async empty(ctx: RequestContext) {
    await ctx.sendResponse(new Response(null, { status: 204, headers: { 'x-empty': '1' } }))
  }
}

class WebResponseModule implements AppModule {
  routes(): ModuleRoutes {
    return { path: '/web', controller: WebResponseController }
  }
}

const runtimes = [
  ['express', undefined],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
  ['h3 v2', () => h3WebRuntime({ h3: h3v2 as never })],
] as const

describe.each(runtimes)('ctx.sendResponse on %s', (_name, runtime) => {
  beforeEach(() => {
    Container.reset()
  })

  async function server() {
    const app = new Application({
      modules: [WebResponseModule],
      ...(runtime ? { runtime: runtime() } : {}),
    } as never)
    await app.startWithoutServer()
    return app
  }

  it('writes status, headers, every Set-Cookie and the streamed body', async () => {
    const app = await server()
    const res = await request((req, rsp) => app.handle(req, rsp)).get('/api/v1/web/stream')
    expect(res.status).toBe(202)
    expect(res.headers['x-web']).toBe('yes')
    expect(res.headers['set-cookie']).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    expect(res.text).toBe('chunk-1;chunk-2')
    await app.shutdown()
  })

  it('ends a response without a body', async () => {
    const app = await server()
    const res = await request((req, rsp) => app.handle(req, rsp)).get('/api/v1/web/empty')
    expect(res.status).toBe(204)
    expect(res.headers['x-empty']).toBe('1')
    await app.shutdown()
  })
})
