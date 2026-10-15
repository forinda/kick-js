import 'reflect-metadata'
import { mkdtemp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { connect } from 'node:net'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import * as tus from 'tus-js-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Application,
  Container,
  Controller,
  Get,
  HttpException,
  createToken,
  type RequestContext,
} from '@forinda/kickjs'
import { fastifyRuntime } from '../../kickjs/src/http/runtimes/fastify'
import { h3Runtime } from '../../kickjs/src/http/runtimes/h3'
import { memoryStorage, type Storage } from '../src/index'
import { diskStorage } from '../src/disk'
import { TusAdapter, createTusHandler, type TusOptions } from '../src/tus'

const RUNTIMES = [
  ['express', undefined],
  ['fastify', fastifyRuntime],
  ['h3', h3Runtime],
] as const

const FILES = createToken<Storage>('Files')
const TUS = { 'Tus-Resumable': '1.0.0' }
const b64 = (value: string) => Buffer.from(value).toString('base64')

beforeEach(() => Container.reset())

const keysIn = async (dir: string) =>
  (await diskStorage({ root: dir }).list()).files.map((f) => f.key)
const sha = (algorithm: string, body: string) =>
  `${algorithm} ${createHash(algorithm).update(body).digest('base64')}`

@Controller()
class PingController {
  @Get('/')
  ping(ctx: RequestContext) {
    ctx.json({ ok: true })
  }
}

async function boot(runtime: (() => unknown) | undefined, options: Partial<TusOptions> = {}) {
  const files = memoryStorage()
  const dir = await mkdtemp(join(tmpdir(), 'kick-tus-'))
  const completed: string[] = []
  const app = new Application({
    modules: [
      class {
        register(container: Container) {
          container.registerInstance(FILES, files)
        }
        routes() {
          return { path: '/ping', controller: PingController }
        }
      },
    ],
    adapters: [
      TusAdapter({
        path: '/uploads',
        storage: FILES,
        dir,
        maxSize: 100,
        onComplete: (upload) => void completed.push(upload.key),
        ...options,
      }),
    ],
    ...(runtime ? { runtime: runtime() as never } : {}),
  })
  await app.setup()
  return { agent: request(app.handle.bind(app)), app, files, dir, completed }
}

describe.each(RUNTIMES)('tus on %s', (_name, runtime) => {
  it('creates, resumes after a partial PATCH, and moves the file into storage', async () => {
    const { agent, files, dir, completed } = await boot(runtime)

    const options = await agent.options('/uploads')
    expect(options.status).toBe(204)
    expect(options.headers['tus-extension']).toBe(
      'creation,creation-with-upload,termination,expiration,checksum,concatenation',
    )
    expect(options.headers['tus-checksum-algorithm']).toBe('sha1,sha256,md5')
    expect(options.headers['tus-max-size']).toBe('100')

    const created = await agent
      .post('/uploads')
      .set(TUS)
      .set('Upload-Length', '11')
      .set('Upload-Metadata', `filename ${b64('hi.txt')},filetype ${b64('text/plain')}`)
      .expect(201)
    const location: string = created.headers.location
    expect(location).toMatch(/^\/uploads\/[0-9a-f-]{36}$/)
    expect(created.headers['upload-expires']).toBeDefined()

    const patch = (offset: number, body: string) =>
      agent
        .patch(location)
        .set(TUS)
        .set('Upload-Offset', String(offset))
        .set('Content-Type', 'application/offset+octet-stream')
        .send(Buffer.from(body))

    expect((await patch(0, 'hello ')).headers['upload-offset']).toBe('6')
    // The client lost track: HEAD says where to resume.
    const head = await agent.head(location).set(TUS).expect(200)
    expect(head.headers).toMatchObject({
      'upload-offset': '6',
      'upload-length': '11',
      'cache-control': 'no-store',
    })
    expect(head.headers['upload-metadata']).toContain('filename')

    expect((await patch(0, 'again')).status).toBe(409)
    expect((await patch(6, 'world')).headers['upload-offset']).toBe('11')

    expect(new TextDecoder().decode((await files.get(completed[0]))!)).toBe('hello world')
    expect((await files.stat(completed[0]))!.contentType).toBe('text/plain')
    expect(completed).toEqual([`uploads/${location.split('/').pop()}`])
    // Only the finished record is left, until it expires.
    const id = location.split('/').pop()
    expect(await keysIn(dir)).toEqual([`tus/${id}/done`, `tus/${id}/info`])
    // A client that missed the last response sees the upload as complete.
    expect((await agent.head(location).set(TUS)).headers['upload-offset']).toBe('11')
    expect((await patch(11, '')).status).toBe(204)
  })

  it('takes the first bytes with the POST (creation-with-upload)', async () => {
    const { agent, files, completed } = await boot(runtime)
    const res = await agent
      .post('/uploads')
      .set(TUS)
      .set('Upload-Length', '3')
      .set('Content-Type', 'application/offset+octet-stream')
      .send(Buffer.from('abc'))
      .expect(201)
    expect(res.headers['upload-offset']).toBe('3')
    expect(new TextDecoder().decode((await files.get(completed[0]))!)).toBe('abc')
  })

  it('refuses what the protocol and the limits refuse', async () => {
    const { agent } = await boot(runtime)
    expect((await agent.post('/uploads').set('Upload-Length', '1')).status).toBe(412)
    expect((await agent.post('/uploads').set(TUS)).status).toBe(400)
    expect((await agent.post('/uploads').set(TUS).set('Upload-Length', '101')).status).toBe(413)
    expect(
      (
        await agent
          .post('/uploads')
          .set(TUS)
          .set('Upload-Length', '1')
          .set('Upload-Metadata', 'a b c')
      ).status,
    ).toBe(400)
    expect((await agent.head('/uploads/../../etc/passwd').set(TUS)).status).toBe(404)
    expect((await agent.head('/uploads/..%2F..%2Fetc%2Fpasswd').set(TUS)).status).toBe(404)
    await agent
      .post('/uploads')
      .set(TUS)
      .set('Upload-Length', '1')
      .set('Upload-Metadata', `__proto__ ${b64('x')}`)
      .expect(201)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(
      (await agent.head('/uploads/00000000-0000-0000-0000-000000000000').set(TUS)).status,
    ).toBe(404)

    const { headers } = await agent.post('/uploads').set(TUS).set('Upload-Length', '2').expect(201)
    const tooMuch = await agent
      .patch(headers.location)
      .set(TUS)
      .set('Upload-Offset', '0')
      .set('Content-Type', 'application/offset+octet-stream')
      .send(Buffer.from('abc'))
    expect(tooMuch.status).toBe(413)
    const wrongType = await agent
      .patch(headers.location)
      .set(TUS)
      .set('Upload-Offset', '0')
      .send('x')
    expect(wrongType.status).toBe(415)
  })

  it('lets onCreate pick the key and refuse, and authorize guard the rest', async () => {
    const { agent, completed } = await boot(runtime, {
      onCreate: ({ headers, metadata }, id) => {
        if (headers.authorization !== 'Bearer u1') throw HttpException.unauthorized()
        if (metadata.filetype !== 'image/png') throw HttpException.badRequest('PNG only')
        return { key: `avatars/u1/${id}.png`, data: { owner: 'u1' } }
      },
      authorize: (headers, upload) => {
        if (headers.authorization !== `Bearer ${(upload.data as { owner: string }).owner}`) {
          throw HttpException.forbidden()
        }
      },
    })
    const png = `filetype ${b64('image/png')}`
    expect(
      (await agent.post('/uploads').set(TUS).set('Upload-Length', '1').set('Upload-Metadata', png))
        .status,
    ).toBe(401)
    const wrongType = await agent
      .post('/uploads')
      .set(TUS)
      .set('Authorization', 'Bearer u1')
      .set('Upload-Length', '1')
      .set('Upload-Metadata', `filetype ${b64('text/html')}`)
    expect(wrongType.status).toBe(400)
    expect(wrongType.text).toBe('PNG only')

    const { headers } = await agent
      .post('/uploads')
      .set(TUS)
      .set('Authorization', 'Bearer u1')
      .set('Upload-Length', '1')
      .set('Upload-Metadata', png)
      .expect(201)
    expect(
      (await agent.head(headers.location).set(TUS).set('Authorization', 'Bearer u2')).status,
    ).toBe(403)
    await agent
      .patch(headers.location)
      .set(TUS)
      .set('Authorization', 'Bearer u1')
      .set('Upload-Offset', '0')
      .set('Content-Type', 'application/offset+octet-stream')
      .send(Buffer.from('x'))
      .expect(204)
    expect(completed[0]).toMatch(/^avatars\/u1\/[0-9a-f-]{36}\.png$/)
  })

  it('runs onComplete again on retry when it failed', async () => {
    let attempts = 0
    const { agent, files } = await boot(runtime, {
      onComplete: () => {
        if (++attempts === 1) throw new Error('database down')
      },
    })
    const { headers } = await agent.post('/uploads').set(TUS).set('Upload-Length', '2').expect(201)
    const send = (offset: string, body: string) =>
      agent
        .patch(headers.location)
        .set(TUS)
        .set('Upload-Offset', offset)
        .set('Content-Type', 'application/offset+octet-stream')
        .send(Buffer.from(body))
    expect((await send('0', 'ok')).status).toBe(500)
    // Not done: HEAD still says complete-length, and the retry finishes it.
    expect((await agent.head(headers.location).set(TUS)).headers['upload-offset']).toBe('2')
    expect((await send('2', '')).status).toBe(204)
    expect(attempts).toBe(2)
    expect(await files.exists(`uploads/${headers.location.split('/').pop()}`)).toBe(true)
    // Done now: a further retry doesn't run it a third time.
    expect((await send('2', '')).status).toBe(204)
    expect(attempts).toBe(2)
  })

  it('checks Upload-Checksum, and drops a chunk that fails it', async () => {
    const { agent, files, completed } = await boot(runtime)
    const { headers } = await agent.post('/uploads').set(TUS).set('Upload-Length', '6').expect(201)
    const patch = (offset: string, body: string, checksum: string) =>
      agent
        .patch(headers.location)
        .set(TUS)
        .set('Upload-Offset', offset)
        .set('Upload-Checksum', checksum)
        .set('Content-Type', 'application/offset+octet-stream')
        .send(Buffer.from(body))
    expect((await patch('0', 'abc', sha('sha1', 'abc'))).headers['upload-offset']).toBe('3')
    const bad = await patch('3', 'def', sha('sha256', 'xyz'))
    expect(bad.status).toBe(460)
    expect((await agent.head(headers.location).set(TUS)).headers['upload-offset']).toBe('3')
    expect((await patch('3', 'def', 'crc32 AAAA')).status).toBe(400)
    expect((await patch('3', 'def', sha('md5', 'def'))).headers['upload-offset']).toBe('6')
    expect(new TextDecoder().decode((await files.get(completed[0]))!)).toBe('abcdef')
  })

  it('joins parallel partial uploads into a final one (concatenation)', async () => {
    const { agent, files, completed } = await boot(runtime)
    const partial = async (body: string) => {
      const { headers } = await agent
        .post('/uploads')
        .set(TUS)
        .set('Upload-Concat', 'partial')
        .set('Upload-Length', String(body.length))
        .expect(201)
      await agent
        .patch(headers.location)
        .set(TUS)
        .set('Upload-Offset', '0')
        .set('Content-Type', 'application/offset+octet-stream')
        .send(Buffer.from(body))
        .expect(204)
      return headers.location as string
    }
    const [a, b] = await Promise.all([partial('hello '), partial('world')])
    // A part completes without reaching the storage.
    expect(completed).toEqual([])
    expect((await agent.head(a).set(TUS)).headers['upload-concat']).toBe('partial')

    const final = await agent
      .post('/uploads')
      .set(TUS)
      .set('Upload-Concat', `final;${a} http://example.test${b}`)
      .set('Upload-Metadata', `filetype ${b64('text/plain')}`)
      .expect(201)
    expect(new TextDecoder().decode((await files.get(completed[0]))!)).toBe('hello world')
    const head = await agent.head(final.headers.location).set(TUS).expect(200)
    expect(head.headers).toMatchObject({ 'upload-offset': '11', 'upload-length': '11' })
    expect(head.headers['upload-concat']).toBe(`final;${a} ${b}`)
    // The parts are gone once joined, and a final upload takes no PATCH.
    expect((await agent.head(a).set(TUS)).status).toBe(404)
    const patched = await agent
      .patch(final.headers.location)
      .set(TUS)
      .set('Upload-Offset', '11')
      .set('Content-Type', 'application/offset+octet-stream')
      .send(Buffer.from(''))
    expect(patched.status).toBe(403)
  })

  it('refuses a final upload of parts that are missing, ordinary or unfinished', async () => {
    const { agent } = await boot(runtime)
    const ordinary = (await agent.post('/uploads').set(TUS).set('Upload-Length', '1')).headers
      .location
    const unfinished = (
      await agent
        .post('/uploads')
        .set(TUS)
        .set('Upload-Concat', 'partial')
        .set('Upload-Length', '1')
    ).headers.location
    const final = (urls: string) =>
      agent.post('/uploads').set(TUS).set('Upload-Concat', `final;${urls}`)
    expect((await final(ordinary)).status).toBe(400)
    expect((await final(unfinished)).text).toContain('not complete')
    expect((await final('/uploads/00000000-0000-0000-0000-000000000000')).status).toBe(400)
    expect((await final('/elsewhere/x')).status).toBe(400)
    expect((await agent.post('/uploads').set(TUS).set('Upload-Concat', 'nonsense')).status).toBe(
      400,
    )
  })

  it('refuses a key under tus/, where unfinished uploads are kept', async () => {
    const { agent } = await boot(runtime, {
      // As if the key were built from the client's file name.
      onCreate: ({ metadata }) => ({ key: metadata.filename }),
    })
    for (const name of ['tus/00000000-0000-0000-0000-000000000000/at/0', 'tus']) {
      const res = await agent
        .post('/uploads')
        .set(TUS)
        .set('Upload-Length', '1')
        .set('Upload-Metadata', `filename ${b64(name)}`)
      expect(res.status).toBe(400)
      expect(res.text).toContain('reserved')
    }
  })

  it('honours X-HTTP-Method-Override on POST only', async () => {
    const { agent } = await boot(runtime)
    const { headers } = await agent.post('/uploads').set(TUS).set('Upload-Length', '5').expect(201)
    // A GET passes csrf() as a safe method; it must not act as a DELETE.
    await agent.get(headers.location).set(TUS).set('X-HTTP-Method-Override', 'DELETE').expect(405)
    expect((await agent.head(headers.location).set(TUS)).status).toBe(200)
    await agent.post(headers.location).set(TUS).set('X-HTTP-Method-Override', 'DELETE').expect(204)
    expect((await agent.head(headers.location).set(TUS)).status).toBe(404)
  })

  it('lets one PATCH write at a time, checking the offset under the lock', async () => {
    let release!: () => void
    const gate = new Promise<void>((done) => (release = done))
    let calls = 0
    const { agent, files, completed } = await boot(runtime, {
      // Hold the first PATCH inside authorize, after it has read offset 0.
      authorize: async () => {
        if (++calls === 1) await gate
      },
    })
    const { headers } = await agent.post('/uploads').set(TUS).set('Upload-Length', '4').expect(201)
    const patch = (body: string) =>
      agent
        .patch(headers.location)
        .set(TUS)
        .set('Upload-Offset', '0')
        .set('Content-Type', 'application/offset+octet-stream')
        .send(Buffer.from(body))
    const first = patch('ab').then((r) => r)
    await new Promise((done) => setTimeout(done, 20))
    const second = await patch('cd')
    expect(second.status).toBe(423)
    release()
    expect((await first).headers['upload-offset']).toBe('2')
    expect(completed).toEqual([])
    expect(await files.list()).toEqual({ files: [] })
  })

  it('terminates an upload, and leaves other routes alone', async () => {
    const { agent, dir } = await boot(runtime)
    const { headers } = await agent.post('/uploads').set(TUS).set('Upload-Length', '5').expect(201)
    await agent.delete(headers.location).set(TUS).expect(204)
    expect((await agent.head(headers.location).set(TUS)).status).toBe(404)
    expect(await keysIn(dir)).toEqual([])
    expect((await agent.get('/api/v1/ping').expect(200)).body).toEqual({ ok: true })
  })
})

describe('with tus-js-client', () => {
  let server: Server | undefined
  afterEach(() => server?.close())

  it('uploads in chunks, survives an abort, and resumes from the upload URL', async () => {
    const { app, files, completed } = await boot(undefined, { maxSize: 10_000 })
    server = createServer((req, res) => app.handle(req, res))
    await new Promise<void>((done) => server!.listen(0, done))
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/uploads`
    const data = Buffer.from('x'.repeat(2500) + 'y'.repeat(2500))

    // First attempt: abort after the first chunk lands.
    const url = await new Promise<string>((done, fail) => {
      const upload = new tus.Upload(data, {
        endpoint,
        chunkSize: 1000,
        metadata: { filename: 'big.txt', filetype: 'text/plain' },
        onError: fail,
        onChunkComplete: () => {
          void upload.abort().then(() => done(upload.url!))
        },
      })
      upload.start()
    })
    const head = await fetch(new URL(url, endpoint), { method: 'HEAD', headers: TUS })
    expect(head.headers.get('upload-offset')).toBe('1000')

    // Second attempt, as after a page reload: same URL, picks up at 1000.
    const offsets: number[] = []
    await new Promise<void>((done, fail) => {
      const upload = new tus.Upload(data, {
        endpoint,
        uploadUrl: url,
        chunkSize: 1000,
        onError: fail,
        onChunkComplete: (_chunk, sent) => void offsets.push(sent),
        onSuccess: () => done(),
      })
      upload.start()
    })
    expect(offsets).toEqual([2000, 3000, 4000, 5000])
    expect(Buffer.from((await files.get(completed[0]))!).equals(data)).toBe(true)
  })
})

describe('across instances, sharing partials', () => {
  const servers: Server[] = []
  afterEach(() => {
    for (const server of servers.splice(0)) server.close()
  })

  /** Two "instances": separate handlers, separate memory, one shared partials store. */
  async function instances(
    count: number,
    extra: Partial<Omit<TusOptions, 'storage' | 'partials'>> = {},
  ) {
    const partials = memoryStorage()
    const files = memoryStorage()
    const completed: string[] = []
    const urls: string[] = []
    for (let i = 0; i < count; i++) {
      const handler = createTusHandler({
        path: '/uploads',
        storage: files,
        partials,
        maxSize: 10_000_000,
        onComplete: (upload) => void completed.push(upload.key),
        ...extra,
      })
      const server = createServer((req, res) => handler(req, res, () => res.writeHead(404).end()))
      servers.push(server)
      await new Promise<void>((done) => server.listen(0, done))
      urls.push(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    }
    return { partials, files, completed, urls }
  }

  const patch = (url: string, offset: number, body: string | Uint8Array) =>
    fetch(url, {
      method: 'PATCH',
      headers: {
        ...TUS,
        'Upload-Offset': String(offset),
        'Content-Type': 'application/offset+octet-stream',
      },
      body,
    })

  it('lets any instance take any request of an upload', async () => {
    const { files, completed, urls } = await instances(2)
    const created = await fetch(`${urls[0]}/uploads`, {
      method: 'POST',
      headers: { ...TUS, 'Upload-Length': '9' },
    })
    const path = created.headers.get('location')!
    expect((await patch(urls[1] + path, 0, 'abc')).headers.get('upload-offset')).toBe('3')
    const head = await fetch(urls[0] + path, { method: 'HEAD', headers: TUS })
    expect(head.headers.get('upload-offset')).toBe('3')
    expect((await patch(urls[0] + path, 3, 'def')).headers.get('upload-offset')).toBe('6')
    expect((await patch(urls[1] + path, 6, 'ghi')).status).toBe(204)
    expect(new TextDecoder().decode((await files.get(completed[0]))!)).toBe('abcdefghi')
  })

  it('keeps one of two writes racing for the same offset on two instances', async () => {
    const { urls, files, completed } = await instances(2)
    const created = await fetch(`${urls[0]}/uploads`, {
      method: 'POST',
      headers: { ...TUS, 'Upload-Length': '4' },
    })
    const path = created.headers.get('location')!
    const [a, b] = await Promise.all([
      patch(urls[0] + path, 0, 'ab'),
      patch(urls[1] + path, 0, 'xy'),
    ])
    expect([a.status, b.status].toSorted()).toEqual([204, 409])
    const winner = a.status === 204 ? 'ab' : 'xy'
    expect(
      (await fetch(urls[1] + path, { method: 'HEAD', headers: TUS })).headers.get('upload-offset'),
    ).toBe('2')
    await patch(urls[0] + path, 2, 'cd')
    expect(new TextDecoder().decode((await files.get(completed[0]))!)).toBe(`${winner}cd`)
  })

  it('keeps the bytes that arrived before the client disconnected', async () => {
    const { urls, partials } = await instances(1)
    const created = await fetch(`${urls[0]}/uploads`, {
      method: 'POST',
      headers: { ...TUS, 'Upload-Length': '1000' },
    })
    const path = created.headers.get('location')!
    const { hostname, port } = new URL(urls[0])
    // Promise 1000 bytes, send 400, then drop the connection.
    await new Promise<void>((done) => {
      const socket = connect(Number(port), hostname, () => {
        socket.write(
          `PATCH ${path} HTTP/1.1\r\nHost: x\r\nTus-Resumable: 1.0.0\r\nUpload-Offset: 0\r\n` +
            'Content-Type: application/offset+octet-stream\r\nContent-Length: 1000\r\n\r\n',
        )
        socket.write('z'.repeat(400), () => setTimeout(() => (socket.destroy(), done()), 50))
      })
    })
    let offset = ''
    for (let i = 0; i < 20 && offset !== '400'; i++) {
      await new Promise((done) => setTimeout(done, 25))
      offset = (await fetch(urls[0] + path, { method: 'HEAD', headers: TUS })).headers.get(
        'upload-offset',
      )!
    }
    expect(offset).toBe('400')
    expect(
      (await partials.list({ prefix: 'tus/' })).files.some((f) => f.key.includes('/chunk/')),
    ).toBe(true)
  })

  it('uploads in parallel with tus-js-client (parallelUploads)', async () => {
    const { urls, files, completed } = await instances(2)
    const data = Buffer.from(
      Array.from({ length: 3000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join(''),
    )
    await new Promise<void>((done, fail) => {
      new tus.Upload(data, {
        endpoint: `${urls[0]}/uploads`,
        parallelUploads: 3,
        metadata: { filetype: 'text/plain' },
        onError: fail,
        onSuccess: () => done(),
      }).start()
    })
    expect(completed).toHaveLength(1)
    expect(Buffer.from((await files.get(completed[0]))!).equals(data)).toBe(true)
    expect((await files.stat(completed[0]))!.contentType).toBe('text/plain')
  })
})
