/**
 * `ApplicationOptions.server` — the production server `start()` creates:
 * plain HTTP (default), HTTPS (`tls`), or HTTP/2 with HTTP/1.1 fallback
 * (`tls` + `http2`). Real servers, real TLS, one run per engine.
 *
 * The certificate is generated at test time (no private key in the repo) and
 * the clients trust it via `ca` — verification stays on. The suite is skipped
 * when `openssl` is not on PATH.
 */
import 'reflect-metadata'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import https from 'node:https'
import { createSecureContext } from 'node:tls'
import http2 from 'node:http2'
import type { AddressInfo } from 'node:net'
import {
  Container,
  Controller,
  Get,
  KickError,
  Post,
  type AppAdapter,
  type KickServer,
  type RequestContext,
} from '../src/index'
import { Application } from '../src/http/application'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'

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
  const dir = mkdtempSync(join(tmpdir(), 'kick-tls-'))
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

beforeEach(() => {
  Container.reset()
})

afterEach(async () => {
  await app?.shutdown()
  app = undefined
})

let upgradeServer: KickServer | undefined

/** Answers every WebSocket handshake with a bare 101, and records the server it was given. */
const upgradeAdapter: AppAdapter = {
  name: 'UpgradeProbe',
  afterStart({ server }) {
    upgradeServer = server
    server?.on('upgrade', (_req, socket) => {
      socket.end(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
      )
    })
  },
}

async function start(runtime: (() => unknown) | undefined, server: object): Promise<number> {
  @Controller()
  class EchoController {
    @Get('/')
    get(ctx: RequestContext) {
      ctx.json({ ok: true })
    }
    @Post('/')
    post(ctx: RequestContext) {
      ctx.json({ body: ctx.body ?? null })
    }
  }
  app = new Application({
    modules: [{ routes: () => ({ path: '/echo', controller: EchoController }) } as never],
    adapters: [upgradeAdapter],
    port: 0,
    server: server as never,
    ...(runtime ? { runtime: runtime() as never } : {}),
  })
  await app.start()
  return (app.getHttpServer()!.address() as AddressInfo).port
}

/** HTTP/1.1 over TLS. */
function https1(port: number, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; version: string; body: string; upgraded: boolean }>(
    (resolve, reject) => {
      const req = https.request(
        { host: 'localhost', port, path: '/api/v1/echo', ca: tls.cert, headers },
        (res) => {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () =>
            resolve({ status: res.statusCode!, version: res.httpVersion, body, upgraded: false }),
          )
        },
      )
      req.on('upgrade', (res, socket) => {
        socket.destroy()
        resolve({ status: res.statusCode!, version: res.httpVersion, body: '', upgraded: true })
      })
      req.on('error', reject)
      req.end()
    },
  )
}

/** HTTP/2 over TLS (ALPN h2). */
function h2(port: number, method: string, body?: string) {
  return new Promise<{ status: number; json: unknown }>((resolve, reject) => {
    const client = http2.connect(`https://localhost:${port}`, { ca: tls.cert })
    client.on('error', reject)
    const req = client.request({
      ':method': method,
      ':path': '/api/v1/echo',
      ...(body ? { 'content-type': 'application/json' } : {}),
    })
    let status = 0
    let text = ''
    req.on('response', (h) => (status = Number(h[':status'])))
    req.on('data', (c) => (text += c))
    req.on('end', () => {
      client.close()
      resolve({ status, json: JSON.parse(text) })
    })
    req.on('error', reject)
    req.end(body)
  })
}

const ALL = [
  ['express', undefined],
  ['fastify', fastifyRuntime],
  ['h3', h3Runtime],
] as const

describe.skipIf(!hasOpenssl)('server: { tls }', () => {
  describe.each(ALL)('under %s', (_name, runtime) => {
    it('serves HTTPS over HTTP/1.1', async () => {
      const port = await start(runtime, { tls })
      const res = await https1(port)
      expect(res).toMatchObject({ status: 200, version: '1.1' })
      expect(JSON.parse(res.body)).toEqual({ ok: true })
    })
  })
})

describe.skipIf(!hasOpenssl)('server: { tls, http2: true }', () => {
  describe.each(ALL.slice(1))('under %s', (_name, runtime) => {
    it('serves GET and POST over HTTP/2', async () => {
      const port = await start(runtime, { tls, http2: true })
      expect(await h2(port, 'GET')).toEqual({ status: 200, json: { ok: true } })
      expect(await h2(port, 'POST', '{"n":1}')).toEqual({ status: 200, json: { body: { n: 1 } } })
    })

    it('keeps serving HTTP/1.1 clients', async () => {
      const port = await start(runtime, { tls, http2: true })
      expect(await https1(port)).toMatchObject({ status: 200, version: '1.1' })
    })

    it('hands adapters a server whose upgrade event reaches WebSocket handshakes', async () => {
      const port = await start(runtime, { tls, http2: true })
      expect(upgradeServer).toBe(app!.getHttpServer())
      const res = await https1(port, { Connection: 'Upgrade', Upgrade: 'websocket' })
      expect(res).toMatchObject({ status: 101, upgraded: true })
    })
  })

  it('fails at boot on Express with KICK007', async () => {
    const err = await start(undefined, { tls, http2: true }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(KickError)
    expect((err as KickError).code).toBe('KICK007')
    expect(app!.getHttpServer()).toBeNull()
  })
})

describe.skipIf(!hasOpenssl)('shutdown with HTTP/2 sessions open', () => {
  it('stops new streams on sessions that were open before shutdown', async () => {
    const port = await start(fastifyRuntime, { tls, http2: true })
    const client = http2.connect(`https://localhost:${port}`, { ca: tls.cert })
    client.on('error', () => {})
    const get = () =>
      new Promise<string>((resolve) => {
        const req = client.request({ ':path': '/api/v1/echo' })
        req.on('response', (h) => resolve(`status ${h[':status']}`))
        req.on('error', (e) => resolve(`refused: ${(e as NodeJS.ErrnoException).code}`))
        req.end()
      })

    expect(await get()).toBe('status 200')
    await app!.shutdown()
    app = undefined

    // The session was open before shutdown; it must not keep serving.
    const after = await Promise.race([
      get(),
      new Promise<string>((resolve) => setTimeout(() => resolve('no answer'), 1000)),
    ])
    expect(after).not.toBe('status 200')
    client.destroy()
  })
})

describe.skipIf(!hasOpenssl)('unusable tls fails at boot with KICK009', () => {
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  })

  it.each([
    ['key without cert', () => ({ key: tls.key }), /cert is missing/],
    ['cert without key', () => ({ cert: tls.cert }), /key is missing/],
    ['no identity at all', () => ({}), /no key\/cert/],
    ['a key that does not match the cert', () => ({ key: otherKey, cert: tls.cert }), /mismatch/i],
  ])('%s', async (_label, makeTls, message) => {
    const err = await start(fastifyRuntime, { tls: makeTls() }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(KickError)
    expect((err as KickError).code).toBe('KICK009')
    expect((err as KickError).message).toMatch(message)
    expect(app!.getHttpServer()).toBeNull()
  })

  it('accepts an SNICallback-only setup', async () => {
    const port = await start(undefined, {
      tls: {
        SNICallback: (_name: string, cb: (err: Error | null, ctx?: unknown) => void) =>
          cb(null, createSecureContext(tls)),
      },
    })
    expect(port).toBeGreaterThan(0)
  })
})

it('fails at boot with KICK008 when http2 has no tls', async () => {
  const err = await start(fastifyRuntime, { http2: true }).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(KickError)
  expect((err as KickError).code).toBe('KICK008')
  expect(app!.getHttpServer()).toBeNull()
})
