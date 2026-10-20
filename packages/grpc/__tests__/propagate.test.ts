/**
 * `propagateCall` on a client used inside a request or an RPC: the request
 * id travels with the outgoing call, and the outgoing call is cancelled when
 * the incoming RPC is. One app calls itself over loopback to play both sides.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Application, Container, Controller, Get, defineModule } from '@forinda/kickjs'
import { createConnectTransport } from '@connectrpc/connect-node'
import { createClient } from '@connectrpc/connect'
import { GrpcAdapter, GrpcMethod, GrpcService, propagateCall, type GrpcContext } from '../src/index'
import { EchoService } from './fixtures/echo-service'

let client: any
let innerAborted: Promise<boolean>
let markInnerAborted: (v: boolean) => void

@GrpcService(EchoService)
class EchoRpc {
  @GrpcMethod()
  async echo(req: any, ctx: GrpcContext) {
    if (req.text === 'outer') return client.echo({ text: 'inner' })
    if (req.text === 'inner') {
      await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve()))
      markInnerAborted(true)
      return { text: 'late' }
    }
    return { text: ctx.header('x-request-id') ?? 'none' }
  }
}
void EchoRpc

@Controller()
class RelayController {
  @Get('/')
  async relay(ctx: any) {
    ctx.json(await client.echo({ text: 'who' }))
  }
}

let server: http.Server
let baseUrl: string
let app: Application

beforeAll(async () => {
  Container.reset()
  app = new Application({
    modules: [
      defineModule({
        name: 'Relay',
        build: () => ({ routes: () => ({ path: '/relay', controller: RelayController }) }),
      })(),
    ],
    adapters: [GrpcAdapter()],
  })
  await app.setup()
  server = http.createServer(app.handle.bind(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  client = createClient(
    EchoService,
    createConnectTransport({ baseUrl, httpVersion: '1.1', interceptors: [propagateCall] }),
  )
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await app.shutdown().catch(() => {})
})

describe('propagateCall', () => {
  it("forwards the current request's x-request-id", async () => {
    const res = await fetch(`${baseUrl}/api/v1/relay`, { headers: { 'x-request-id': 'req-42' } })
    expect(await res.json()).toMatchObject({ text: 'req-42' })
  })

  it('does nothing outside a request', async () => {
    expect(await client.echo({ text: 'who' })).toMatchObject({ text: 'none' })
  })

  it('cancels the outgoing call when the incoming RPC hits its deadline', async () => {
    innerAborted = new Promise((resolve) => (markInnerAborted = resolve))
    await expect(client.echo({ text: 'outer' }, { timeoutMs: 200 })).rejects.toThrow()
    expect(
      await Promise.race([innerAborted, new Promise((r) => setTimeout(() => r(false), 2000))]),
    ).toBe(true)
  })
})
