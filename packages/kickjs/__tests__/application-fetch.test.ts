/**
 * `Application.fetch` / `AdapterContext.fetch`: run a web Request through the
 * app's pipeline without a listening server — how adapters call the app's
 * own routes (MCP and AI tool dispatch).
 */
import 'reflect-metadata'
import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Application,
  Container,
  Controller,
  Get,
  type AdapterContext,
  type AppModule,
  type ModuleRoutes,
  type RequestContext,
} from '../src/index'
import { h3Runtime } from '../src/http/runtimes/h3'

@Controller()
class EchoController {
  @Get('/')
  echo(ctx: RequestContext) {
    ctx.json({ tenant: ctx.headers['x-tenant'] ?? null, q: ctx.query.q ?? null })
  }
}

class EchoModule implements AppModule {
  routes(): ModuleRoutes {
    return { path: '/echo', controller: EchoController }
  }
}

const apps: Application[] = []
beforeEach(() => {
  Container.reset()
})
afterEach(async () => {
  while (apps.length) await apps.pop()!.shutdown()
})

describe.each([
  ['express', undefined],
  ['h3', () => h3Runtime()],
] as const)('AdapterContext.fetch on %s', (_name, runtime) => {
  it('reaches routes from an adapter hook, before any server listens', async () => {
    let seen: unknown
    const app = new Application({
      modules: [EchoModule],
      adapters: [
        {
          name: 'Caller',
          async beforeStart(ctx: AdapterContext) {
            const res = await ctx.fetch(
              new Request('http://localhost/api/v1/echo?q=1', { headers: { 'x-tenant': 'acme' } }),
            )
            seen = { status: res.status, body: await res.json() }
          },
        },
      ],
      ...(runtime ? { runtime: runtime() } : {}),
    } as never)
    apps.push(app)
    await app.startWithoutServer()

    expect(seen).toEqual({ status: 200, body: { tenant: 'acme', q: '1' } })
  })
})

describe('Application.fetch — loopback lifecycle', () => {
  it('starts one forwarding server on first use and closes it on shutdown', async () => {
    const createServer = vi.spyOn(http, 'createServer')
    try {
      const app = new Application({ modules: [EchoModule] })
      await app.startWithoutServer()

      await app.fetch(new Request('http://localhost/api/v1/echo'))
      await app.fetch(new Request('http://localhost/api/v1/echo'))
      expect(createServer).toHaveBeenCalledTimes(1)
      const server = createServer.mock.results[0].value as http.Server
      expect(server.listening).toBe(true)

      await app.shutdown()
      expect(server.listening).toBe(false)
    } finally {
      createServer.mockRestore()
    }
  })
})
