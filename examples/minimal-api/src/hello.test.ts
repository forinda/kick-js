import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Controller, Get, Container } from '@forinda/kickjs'
import type { AppModule, ModuleRoutes } from '@forinda/kickjs'
import { RequestContext, buildRoutes } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

// ── Controller under test ────────────────────────────────────────────

@Controller()
class HelloController {
  @Get('/')
  async hello(ctx: RequestContext) {
    ctx.json({ message: 'Hello from KickJS minimal template' })
  }
}

class HelloModule implements AppModule {
  register(_container: Container): void {}

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(HelloController),
      controller: HelloController,
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Minimal API — HelloController', () => {
  beforeEach(() => Container.reset())

  it('GET / returns hello message', async () => {
    const { expressApp } = await createTestApp({ modules: [HelloModule] })

    // Routes are mounted at /api/v1/ by default when no apiPrefix is set
    // but HelloModule mounts at path '/' → full path is /api/v1/
    const res = await request(expressApp).get('/api/v1/').expect(200)

    expect(res.body).toEqual({ message: 'Hello from KickJS minimal template' })
  })

  it('GET / returns JSON content type', async () => {
    const { expressApp } = await createTestApp({ modules: [HelloModule] })

    const res = await request(expressApp).get('/')

    expect(res.headers['content-type']).toMatch(/application\/json/)
  })

  it('GET /unknown returns 404', async () => {
    const { expressApp } = await createTestApp({ modules: [HelloModule] })

    await request(expressApp).get('/unknown').expect(404)
  })
})
