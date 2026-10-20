/**
 * Native gRPC from the app itself: on Fastify and h3, `server: { tls, http2:
 * true }` gives Connect the HTTP/2 stream and trailers the binary protocol
 * needs — no proxy in front. HTTP/1.1 clients keep the same port.
 *
 * The certificate is generated at test time (no private key in the repo).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Application, Container } from '@forinda/kickjs'
import { createConnectTransport, createGrpcTransport } from '@connectrpc/connect-node'
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

  @GrpcMethod()
  async *echoStream(req: any) {
    yield { text: `${req.text}-1` }
    yield { text: `${req.text}-2` }
  }
}
void EchoRpc

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

let tls: { key: Buffer; cert: Buffer }
let app: Application | undefined

beforeAll(() => {
  if (!hasOpenssl) return
  const dir = mkdtempSync(join(tmpdir(), 'kick-grpc-tls-'))
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  )
  tls = { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }
})

afterEach(async () => {
  await app?.shutdown()
  app = undefined
})

describe.skipIf(!hasOpenssl).each([
  ['fastify', fastifyRuntime],
  ['h3', h3Runtime],
] as const)('native gRPC under %s with server: { tls, http2: true }', (_name, runtime) => {
  async function start(): Promise<string> {
    Container.reset()
    app = new Application({
      modules: [],
      adapters: [GrpcAdapter()],
      port: 0,
      runtime: runtime() as never,
      server: { tls, http2: true },
    })
    await app.start()
    return `https://localhost:${(app.getHttpServer()!.address() as AddressInfo).port}`
  }

  it('answers unary and server-streaming RPCs', async () => {
    const baseUrl = await start()
    const client = createClient(
      EchoService,
      createGrpcTransport({ baseUrl, nodeOptions: { ca: tls.cert } }),
    ) as any

    expect(await client.echo({ text: 'hi' })).toMatchObject({ text: 'hi:grpc' })
    const out: string[] = []
    for await (const m of client.echoStream({ text: 's' })) out.push(m.text)
    expect(out).toEqual(['s-1', 's-2'])
  }, 20_000)

  it('still serves Connect over HTTP/1.1 on the same port', async () => {
    const baseUrl = await start()
    const client = createClient(
      EchoService,
      createConnectTransport({ baseUrl, httpVersion: '1.1', nodeOptions: { ca: tls.cert } }),
    ) as any

    expect(await client.echo({ text: 'hi' })).toMatchObject({ text: 'hi:connect' })
  }, 20_000)
})
