import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { Controller, Get, defineModule, helmet } from '@forinda/kickjs'
import { createTestApp } from '../src'

@Controller()
class PingController {
  @Get('/ping')
  ping(ctx: any) {
    return ctx.json({ ok: true })
  }
}

const PingModule = defineModule({
  name: 'PingModule',
  build: () => ({
    routes() {
      return { path: '/ping', controller: PingController, version: false, prefix: false }
    },
  }),
})

describe('helmet opt-out via user middleware', () => {
  it('an explicit frameguard: false actually removes X-Frame-Options', async () => {
    const { app } = await createTestApp({
      modules: [PingModule()],
      middleware: [helmet({ frameguard: false })],
    })
    const res = await request(app.handle.bind(app)).get('/ping')
    expect(res.headers['x-frame-options']).toBeUndefined()
  })

  it('scaffolded helmet() adds nothing over the auto-injected one', async () => {
    const bare = await createTestApp({ modules: [PingModule()], middleware: [] })
    const withHelmet = await createTestApp({ modules: [PingModule()], middleware: [helmet()] })
    const a = await request(bare.app.handle.bind(bare.app)).get('/ping')
    const b = await request(withHelmet.app.handle.bind(withHelmet.app)).get('/ping')
    const names = (r: any) => Object.keys(r.headers).toSorted().join(',')
    expect(names(b)).toBe(names(a))
  })
})
