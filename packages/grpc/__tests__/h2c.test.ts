/**
 * Behind a service mesh: the sidecar speaks cleartext HTTP/2 to the app, so
 * `server: { http2: 'h2c' }` is enough for native gRPC — no certificate.
 */
import { describe, it, expect, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import { Application, Container } from '@forinda/kickjs'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { createClient } from '@connectrpc/connect'
import { fastifyRuntime } from '../../kickjs/src/http/runtimes/fastify'
import { h3Runtime } from '../../kickjs/src/http/runtimes/h3'
import { GrpcAdapter, GrpcMethod, GrpcService, type GrpcContext } from '../src/index'
import { EchoService } from './fixtures/echo-service'

@GrpcService(EchoService)
class EchoRpc {
  @GrpcMethod()
  echo(req: any, ctx: GrpcContext) {
    return { text: `${req.text}:${ctx.protocol}` }
  }
}
void EchoRpc

let app: Application | undefined

afterEach(async () => {
  await app?.shutdown()
  app = undefined
})

describe.each([
  ['fastify', fastifyRuntime],
  ['h3', h3Runtime],
] as const)("native gRPC under %s with server: { http2: 'h2c' }", (_name, runtime) => {
  it('answers a gRPC client over cleartext HTTP/2', async () => {
    Container.reset()
    app = new Application({
      modules: [],
      adapters: [GrpcAdapter()],
      port: 0,
      runtime: runtime() as never,
      server: { http2: 'h2c' },
    })
    await app.start()
    const baseUrl = `http://localhost:${(app.getHttpServer()!.address() as AddressInfo).port}`
    const client = createClient(EchoService, createGrpcTransport({ baseUrl })) as any

    expect(await client.echo({ text: 'hi' })).toMatchObject({ text: 'hi:grpc' })
  }, 20_000)
})
