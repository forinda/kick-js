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

describe('a pending render and a returned value', () => {
  it('waits for the render; the returned value is not sent over it', async () => {
    const { applyHandlerResult } = await import('../src/http/reply')
    const { setPendingResponse } = await import('../src/http/view-renderer')
    const calls: string[] = []
    const ctx = {
      json: () => calls.push('json'),
    } as never
    let finish!: () => void
    setPendingResponse(
      ctx,
      new Promise<void>((r) => (finish = r)).then(() => void calls.push('html')),
    )
    const done = applyHandlerResult(ctx, { a: 1 })
    finish()
    await done
    expect(calls).toEqual(['html'])
  })
})

describe('headFromGet', () => {
  it('cancels a streaming body', async () => {
    const { headFromGet } = await import('../src/http/web/handler')
    let cancelled = false
    const body = new ReadableStream({
      pull() {},
      cancel() {
        cancelled = true
      },
    })
    const res = await headFromGet(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    expect(res.body).toBeNull()
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(cancelled).toBe(true)
  })
})
