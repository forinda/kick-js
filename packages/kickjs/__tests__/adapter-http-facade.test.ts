import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import {
  Application,
  Container,
  Controller,
  Get,
  RequestContext,
  buildRouteTable,
  type AppAdapter,
} from '../src/index'

beforeEach(() => {
  Container.reset()
})

describe('AdapterContext.http facade (M2a)', () => {
  it('route() / use() / serveStatic() register through the runtime', async () => {
    const adapter: AppAdapter = {
      name: 'FacadeAdapter',
      beforeMount(ctx) {
        expect(ctx.http).toBeDefined()
        ctx.http.use((_req, res, next) => {
          res.setHeader('x-facade', 'on')
          next()
        })
        ctx.http.route('GET', '/_facade/ping', (c: RequestContext) => c.json({ ok: true }))
        ctx.http.serveStatic('/_facade/static', __dirname)
      },
    }

    const app = new Application({ modules: [], adapters: [adapter] })
    await app.setup()
    const http = app.getExpressApp()

    const ping = await request(http).get('/_facade/ping').expect(200)
    expect(ping.body).toEqual({ ok: true })
    expect(ping.headers['x-facade']).toBe('on')

    await request(http).get('/_facade/static/adapter-http-facade.test.ts').expect(200)
  })

  it('mount() materializes a pre-built route table under a prefix', async () => {
    @Controller()
    class WidgetController {
      @Get('/:id')
      get(ctx: RequestContext) {
        ctx.json({ id: ctx.params.id })
      }
    }

    const adapter: AppAdapter = {
      name: 'MountAdapter',
      beforeMount(ctx) {
        ctx.http.mount('/_widgets', buildRouteTable(WidgetController))
      },
    }

    const app = new Application({ modules: [], adapters: [adapter] })
    await app.setup()

    const res = await request(app.getExpressApp()).get('/_widgets/42').expect(200)
    expect(res.body).toEqual({ id: '42' })
  })

  it('exposes the engine-native app alongside the facade (escape hatch)', async () => {
    let sawApp = false
    const adapter: AppAdapter = {
      name: 'EscapeHatch',
      beforeMount(ctx) {
        sawApp = typeof ctx.app?.use === 'function'
      },
    }
    const app = new Application({ modules: [], adapters: [adapter] })
    await app.setup()
    expect(sawApp).toBe(true)
  })
})
