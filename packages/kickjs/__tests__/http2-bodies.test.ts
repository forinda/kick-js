/**
 * Request bodies over HTTP/2. HTTP/2 frames a body in DATA frames: there is no
 * `transfer-encoding`, and `content-length` is optional — so a runtime that
 * decides "was a body sent" from those two headers alone drops a streamed
 * HTTP/2 body. Express is absent on purpose: it cannot run on Node's HTTP/2
 * compatibility layer at all.
 */
import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http2 from 'node:http2'
import type { AddressInfo } from 'node:net'
import {
  Application,
  Container,
  Controller,
  FileUpload,
  Post,
  type RequestContext,
} from '../src/index'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'

let server: http2.Http2Server | undefined

beforeEach(() => {
  Container.reset()
})

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined))
  server = undefined
})

async function boot(runtime: () => unknown): Promise<number> {
  @Controller()
  class EchoController {
    @Post('/')
    echo(ctx: RequestContext) {
      ctx.json({ body: ctx.body ?? null })
    }

    @Post('/upload')
    @FileUpload({ mode: 'single', fieldName: 'file' })
    upload(ctx: RequestContext) {
      ctx.json({
        name: ctx.file?.originalname ?? null,
        hex: ctx.file?.buffer.toString('hex') ?? null,
        note: (ctx.body as { note?: string } | undefined)?.note ?? null,
      })
    }
  }
  const app = new Application({
    modules: [{ routes: () => ({ path: '/echo', controller: EchoController }) } as never],
    runtime: runtime() as never,
  })
  await app.setup()
  server = http2.createServer((req, res) => app.handle(req as never, res as never))
  await new Promise<void>((resolve) => server!.listen(0, resolve))
  return (server!.address() as AddressInfo).port
}

function post(
  port: number,
  body: string | Buffer | undefined,
  headers: Record<string, string>,
  path = '/api/v1/echo',
) {
  return new Promise<{ status: number; json: unknown }>((resolve, reject) => {
    const client = http2.connect(`http://127.0.0.1:${port}`)
    client.on('error', reject)
    const req = client.request({ ':method': 'POST', ':path': path, ...headers })
    let status = 0
    let text = ''
    req.on('response', (h) => (status = Number(h[':status'])))
    req.on('data', (chunk) => (text += chunk))
    req.on('end', () => {
      client.close()
      resolve({ status, json: text ? JSON.parse(text) : undefined })
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

describe.each([
  ['fastify', fastifyRuntime],
  ['h3', h3Runtime],
] as const)('request bodies over HTTP/2 under %s', (_name, runtime) => {
  it('reads a JSON body sent without content-length', async () => {
    const port = await boot(runtime)
    const res = await post(port, '{"n":1}', { 'content-type': 'application/json' })
    expect(res).toEqual({ status: 200, json: { body: { n: 1 } } })
  })

  it('reads a JSON body sent with content-length', async () => {
    const port = await boot(runtime)
    const res = await post(port, '{"n":2}', {
      'content-type': 'application/json',
      'content-length': '7',
    })
    expect(res).toEqual({ status: 200, json: { body: { n: 2 } } })
  })

  it('reads a multipart upload sent without content-length, bytes intact', async () => {
    const port = await boot(runtime)
    const boundary = 'kickboundary'
    // Not valid UTF-8 — any decode-as-text step would corrupt it.
    const bytes = Buffer.from([0xff, 0x00, 0xfe, 0x80])
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b.bin"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const res = await post(
      port,
      body,
      { 'content-type': `multipart/form-data; boundary=${boundary}` },
      '/api/v1/echo/upload',
    )
    expect(res).toEqual({
      status: 200,
      json: { name: 'b.bin', hex: 'ff00fe80', note: 'hello' },
    })
  })

  it('treats a POST with no body as no body', async () => {
    const port = await boot(runtime)
    const res = await post(port, undefined, {})
    expect(res.status).toBe(200)
  })
})
