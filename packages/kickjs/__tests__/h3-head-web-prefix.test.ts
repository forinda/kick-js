/**
 * HEAD answers every GET route on h3 and the web entry, as Express and
 * Fastify do; and the web entry honours a module route's `prefix: false`.
 */
import 'reflect-metadata'
import request from 'supertest'
import * as h3v2 from 'h3'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  Application,
  Container,
  Controller,
  Get,
  defineModule,
  type RequestContext,
} from '../src/index'
import { h3Runtime } from '../src/http/runtimes/h3'
import { createWebApp } from '../src/web'

@Controller()
class PagesController {
  @Get('/page')
  page(ctx: RequestContext) {
    ctx.setHeader('x-page', '1')
    ctx.html('<h1>page</h1>')
  }
}

const routes = (prefix?: false) => ({
  path: '/',
  controller: PagesController,
  version: false as const,
  ...(prefix === false ? { prefix } : {}),
})

beforeEach(() => Container.reset())

describe('HEAD on GET routes', () => {
  it('h3 runtime', async () => {
    const app = new Application({
      runtime: h3Runtime() as never,
      modules: [
        class {
          routes() {
            return routes(false)
          }
        } as never,
      ],
    })
    await app.setup()
    const res = await request(app.handle.bind(app)).head('/page').expect(200)
    expect(res.headers['x-page']).toBe('1')
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text ?? '').toBe('')
  })

  it('web entry', async () => {
    const web = createWebApp({
      h3: h3v2,
      modules: [defineModule({ name: 'P', build: () => ({ routes: () => routes(false) }) })()],
    })
    const res = await web.fetch(new Request('http://e/page', { method: 'HEAD' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-page')).toBe('1')
    expect(await res.text()).toBe('')
  })
})

describe('web entry prefix: false', () => {
  it('mounts at the root', async () => {
    const web = createWebApp({
      h3: h3v2,
      modules: [defineModule({ name: 'P', build: () => ({ routes: () => routes(false) }) })()],
    })
    expect((await web.fetch(new Request('http://e/page'))).status).toBe(200)
    expect((await web.fetch(new Request('http://e/api/page'))).status).toBe(404)
  })

  it('keeps the prefix otherwise', async () => {
    const web = createWebApp({
      h3: h3v2,
      modules: [defineModule({ name: 'P', build: () => ({ routes: () => routes() }) })()],
    })
    expect((await web.fetch(new Request('http://e/api/page'))).status).toBe(200)
  })
})
