/** serveStatic serves a file's `.br` / `.gz` sibling to a client that accepts it — every runtime. */
import 'reflect-metadata'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Container } from '../src/index'
import { Application } from '../src/http/application'
import { expressRuntime } from '../src/http/runtimes/express'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import { acceptsEncoding } from '../src/http/runtimes/precompressed'
import type { AppAdapter, KickServer } from '../src/core'

const js = 'export const answer = 42\n'.repeat(200)
let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kick-precompressed-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets/app.js'), js)
  writeFileSync(join(dir, 'assets/app.js.br'), brotliCompressSync(js))
  writeFileSync(join(dir, 'assets/app.js.gz'), gzipSync(js))
  writeFileSync(join(dir, 'assets/plain.css'), 'body{color:red}\n'.repeat(100))
  writeFileSync(join(dir, 'secret.txt.br'), 'outside the static root')
})

/** Raw response: headers and the bytes as sent (no decoding, unlike fetch). */
function get(port: number, path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }>(
    (resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }),
        )
      })
      req.on('error', reject)
      req.end()
    },
  )
}

const runtimes = [
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

describe.each(runtimes)('precompressed static files on %s', (_name, runtime) => {
  let app: Application | undefined
  afterEach(async () => {
    await app?.shutdown()
    app = undefined
  })

  it('serves the sibling the client accepts, typed as the original', async () => {
    Container.reset()
    let server: KickServer | undefined
    const statics: AppAdapter = {
      name: 'Statics',
      beforeMount: ({ http }) => http.serveStatic('/static', join(dir, 'assets')),
      afterStart: ({ server: s }) => void (server = s),
    }
    app = new Application({ modules: [], adapters: [statics], runtime: runtime(), port: 0 })
    await app.start()
    const port = (server!.address() as AddressInfo).port

    const br = await get(port, '/static/app.js', { 'accept-encoding': 'gzip, deflate, br' })
    expect(br.status).toBe(200)
    expect(br.headers['content-encoding']).toBe('br')
    expect(br.headers['content-type']).toMatch(/^text\/javascript/)
    expect(br.headers['vary']).toMatch(/accept-encoding/i)
    expect(br.body).toEqual(brotliCompressSync(js))

    const gz = await get(port, '/static/app.js', { 'accept-encoding': 'gzip, br;q=0' })
    expect(gz.headers['content-encoding']).toBe('gzip')
    expect(gz.body).toEqual(gzipSync(js))

    const plain = await get(port, '/static/app.js')
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.body.toString()).toBe(js)
    expect(plain.headers['vary']).toMatch(/accept-encoding/i)

    // A byte range is of the file as stored.
    const range = await get(port, '/static/app.js', { 'accept-encoding': 'br', range: 'bytes=0-5' })
    expect(range.status).toBe(206)
    expect(range.headers['content-encoding']).toBeUndefined()
    expect(range.body.toString()).toBe(js.slice(0, 6))

    const head = await get(port, '/static/app.js', { 'accept-encoding': 'br' }, 'HEAD')
    expect(head.headers['content-encoding']).toBe('br')
    expect(head.body.length).toBe(0)

    // No sibling: the original.
    const css = await get(port, '/static/plain.css', { 'accept-encoding': 'br' })
    expect(css.status).toBe(200)
    expect(css.headers['content-encoding']).toBeUndefined()

    // Nothing outside the static root, compressed or not.
    const escape = await get(port, '/static/..%2fsecret.txt', { 'accept-encoding': 'br' })
    expect(escape.headers['content-encoding']).toBeUndefined()
    expect(escape.body.toString()).not.toContain('outside the static root')
  })
})

describe('acceptsEncoding', () => {
  it('reads names, q-values and *', () => {
    expect(acceptsEncoding('gzip, br', 'br')).toBe(true)
    expect(acceptsEncoding('gzip, br;q=0', 'br')).toBe(false)
    expect(acceptsEncoding('gzip', 'br')).toBe(false)
    expect(acceptsEncoding('*', 'br')).toBe(true)
    expect(acceptsEncoding('*;q=0, gzip', 'br')).toBe(false)
    expect(acceptsEncoding('', 'gzip')).toBe(false)
  })
})
