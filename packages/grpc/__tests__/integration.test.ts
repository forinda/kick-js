/**
 * End-to-end check of the claim that makes this adapter worth having:
 * RPCs and HTTP routes are served by **one app on one port**.
 *
 * Runs a real `http.Server` over the KickJS Application so the middleware
 * phase actually matters — if the adapter were mounted after the global
 * stack, `express.json()` would have drained the request body before Connect
 * could read it, and every RPC here would hang or fail.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Application, Container, Controller, Get, defineModule } from '@forinda/kickjs'
import { createConnectTransport } from '@connectrpc/connect-node'
import { Code, ConnectError, createClient } from '@connectrpc/connect'
import { GrpcAdapter, GrpcMethod, GrpcService, type GrpcContext } from '../src/index'
import { EchoService } from './fixtures/echo-service'

@GrpcService(EchoService)
class EchoRpc {
  @GrpcMethod()
  echo(req: any, ctx: GrpcContext) {
    if (req.text === 'boom') throw new ConnectError('nope', Code.PermissionDenied)
    return { text: `${req.text}:${ctx.protocol}` }
  }

  @GrpcMethod()
  async *echoStream(req: any) {
    yield { text: `${req.text}-1` }
    yield { text: `${req.text}-2` }
  }
}

@Controller()
class HttpController {
  @Get('/ping')
  ping(ctx: any) {
    return ctx.json({ pong: true })
  }
}

const AppModule = defineModule({
  name: 'IntegrationModule',
  build: () => ({
    register(container) {
      // @GrpcService already registers the class; this is the explicit form a
      // module would use when it owns the RPC implementation.
      if (!container.has(EchoRpc)) container.register(EchoRpc, EchoRpc)
    },
    routes: () => ({ path: '/http', controller: HttpController }),
  }),
})

let server: http.Server
let baseUrl: string
let app: Application

beforeAll(async () => {
  Container.reset()

  app = new Application({
    modules: [AppModule()],
    adapters: [GrpcAdapter()],
  })
  await app.setup()

  server = http.createServer(app.handle.bind(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await app.shutdown().catch(() => {})
})

function client() {
  return createClient(EchoService, createConnectTransport({ baseUrl, httpVersion: '1.1' })) as any
}

describe('shared port', () => {
  it('serves a unary RPC over the Connect protocol', async () => {
    const res = await client().echo({ text: 'hello' })
    expect(res.text).toBe('hello:connect')
  })

  it('serves a server-streaming RPC', async () => {
    const out: string[] = []
    for await (const msg of client().echoStream({ text: 'x' })) out.push(msg.text)
    expect(out).toEqual(['x-1', 'x-2'])
  })

  it('propagates error codes to the client', async () => {
    const err = await client()
      .echo({ text: 'boom' })
      .catch((e: unknown) => e)
    expect(ConnectError.from(err).code).toBe(Code.PermissionDenied)
  })

  it('is curl-able as plain JSON over HTTP', async () => {
    const res = await fetch(`${baseUrl}/test.v1.EchoService/Echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'raw' }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'raw:connect' })
  })

  it('leaves ordinary HTTP routes on the same port untouched', async () => {
    // HTTP routes keep the `apiPrefix` + version mount (`/api/v1/...`);
    // RPCs sit at the root because gRPC clients cannot send a path prefix.
    const res = await fetch(`${baseUrl}/api/v1/http/ping`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pong: true })
  })

  it('falls through to the KickJS 404 for unknown paths', async () => {
    const res = await fetch(`${baseUrl}/not-a-route`)
    expect(res.status).toBe(404)
  })
})
