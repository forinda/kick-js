import 'reflect-metadata'
import { gunzipSync, gzipSync } from 'node:zlib'
import compression from 'compression'
import { createServer, get as httpGet } from 'node:http'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import { padGzipHeader } from '../src/http/middleware/breach-padding'
import {
  Application,
  Container,
  Controller,
  Get,
  breachPadding,
  expressRuntime,
  type RequestContext,
} from '../src/index'

describe('padGzipHeader', () => {
  it('adds a random-length name that decompressors ignore', () => {
    const gz = gzipSync(Buffer.from('secret=abc '.repeat(200)))
    const lengths = new Set<number>()
    for (let i = 0; i < 50; i++) {
      const padded = padGzipHeader(gz, 100)
      expect(gunzipSync(padded).toString()).toBe('secret=abc '.repeat(200))
      expect(padded[3]).toBe(0x08)
      lengths.add(padded.length)
    }
    // Sizes vary — the point of it.
    expect(lengths.size).toBeGreaterThan(10)
    for (const length of lengths) {
      expect(length).toBeGreaterThan(gz.length)
      expect(length).toBeLessThanOrEqual(gz.length + 100)
    }
  })

  it('leaves anything that is not a plain gzip header alone', () => {
    const json = Buffer.from('{"a":1}')
    expect(padGzipHeader(json, 100)).toBe(json)
    const flagged = Buffer.from(gzipSync('x'))
    flagged[3] = 0x08
    expect(padGzipHeader(flagged, 100)).toBe(flagged)
  })
})

const RUNTIMES = [
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

for (const [name, runtime] of RUNTIMES)
  describe(`breachPadding() before compression() — ${name}`, () => {
    beforeEach(() => Container.reset())

    it('serves gzip with varying sizes, even to a client that prefers Brotli', async () => {
      @Controller()
      class C {
        @Get('/page')
        page(ctx: RequestContext) {
          ctx.json({ token: 'abc123', text: 'lorem ipsum '.repeat(400) })
        }
      }
      const app = new Application({
        runtime: runtime(),
        middlewares: [breachPadding(), compression()],
        modules: [{ routes: () => ({ path: '/b', controller: C }) } as never],
      })
      await app.setup()
      // A raw request: the exact bytes on the wire, not decompressed for us.
      const server = createServer(app.handle.bind(app))
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const { port } = server.address() as { port: number }
      const fetchRaw = () =>
        new Promise<{ encoding?: string; body: Buffer }>((resolve, reject) => {
          httpGet(
            {
              host: '127.0.0.1',
              port,
              path: '/api/v1/b/page',
              headers: { 'accept-encoding': 'br, gzip, deflate, zstd' },
            },
            (res) => {
              const chunks: Buffer[] = []
              res.on('data', (c: Buffer) => chunks.push(c))
              res.on('end', () =>
                resolve({
                  encoding: res.headers['content-encoding'],
                  body: Buffer.concat(chunks),
                }),
              )
            },
          ).on('error', reject)
        })

      const sizes = new Set<number>()
      try {
        for (let i = 0; i < 12; i++) {
          const { encoding, body } = await fetchRaw()
          expect(encoding).toBe('gzip')
          expect(JSON.parse(gunzipSync(body).toString()).token).toBe('abc123')
          sizes.add(body.length)
        }
      } finally {
        await new Promise((r) => server.close(r))
      }
      expect(sizes.size).toBeGreaterThan(3)
    })
  })
