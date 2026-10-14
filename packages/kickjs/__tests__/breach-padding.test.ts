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

/** A fake response recording what reaches the wire. */
function recorder(encoding: string) {
  const out: Buffer[] = []
  const res = {
    getHeader: () => encoding,
    write: (chunk: unknown) => (out.push(Buffer.from(chunk as Uint8Array | string)), true),
    end: (chunk?: unknown) => {
      if (chunk !== undefined && typeof chunk !== 'function') {
        out.push(Buffer.from(chunk as Uint8Array | string))
      }
      return res
    },
  }
  return { res, bytes: () => Buffer.concat(out) }
}

describe('breachPadding() with short writes', () => {
  const run = (encoding: string, steps: (res: { write: Function; end: Function }) => void) => {
    const { res, bytes } = recorder(encoding)
    breachPadding()({ headers: {} } as never, res as never, () => {})
    steps(res as never)
    return bytes()
  }

  it('never drops bytes held for an incomplete header', () => {
    // A short binary write, then a string: padding is abandoned, both go out.
    expect(
      run('gzip', (res) => {
        res.write(Buffer.from([1, 2, 3]))
        res.write('rest')
        res.end()
      }).equals(Buffer.concat([Buffer.from([1, 2, 3]), Buffer.from('rest')])),
    ).toBe(true)
    // A short write, then end(callback).
    expect(
      run('gzip', (res) => {
        res.write(Buffer.from([1, 2, 3]))
        res.end(() => {})
      }).equals(Buffer.from([1, 2, 3])),
    ).toBe(true)
  })

  it('pads a gzip header split across writes', () => {
    const gz = gzipSync(Buffer.from('hello '.repeat(100)))
    const sent = run('gzip', (res) => {
      res.write(gz.subarray(0, 4))
      res.write(gz.subarray(4))
      res.end()
    })
    expect(sent[3]).toBe(0x08)
    expect(gunzipSync(sent).toString()).toBe('hello '.repeat(100))
  })
})

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
