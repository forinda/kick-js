/**
 * Application.fetch on a runtime without a native fetch goes through an
 * in-process loopback server. The route must see the Host the Request was
 * addressed to — tenant-by-host apps depend on it — and a client that finds
 * the loopback port must not be able to choose that host.
 */
import 'reflect-metadata'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  Application,
  Container,
  Controller,
  Get,
  type AppModule,
  type ModuleRoutes,
  type RequestContext,
} from '../src/index'

@Controller()
class HostController {
  @Get('/')
  host(ctx: RequestContext) {
    return { host: ctx.req.headers.host, internal: ctx.req.headers['x-kick-loopback-host'] ?? null }
  }
}

class HostModule implements AppModule {
  routes(): ModuleRoutes {
    return { path: '/host', controller: HostController }
  }
}

const apps: Application[] = []
beforeEach(() => Container.reset())
afterEach(async () => {
  while (apps.length) await apps.pop()!.shutdown()
})

it('passes the Request host through as Host', async () => {
  const app = new Application({ modules: [HostModule] })
  apps.push(app)
  await app.setup()
  const res = await app.fetch(new Request('http://acme.example.com/api/v1/host'))
  expect(await res.json()).toEqual({ host: 'acme.example.com', internal: null })
})

it("doesn't let a caller choose the host with the internal header", async () => {
  const app = new Application({ modules: [HostModule] })
  apps.push(app)
  await app.setup()
  const res = await app.fetch(
    new Request('http://real.example.com/api/v1/host', {
      headers: { 'x-kick-loopback-host': 'evil.example.com', 'x-kick-loopback-secret': 'guess' },
    }),
  )
  expect(await res.json()).toEqual({ host: 'real.example.com', internal: null })
})
