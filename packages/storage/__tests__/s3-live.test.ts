/**
 * Against a real S3 API. Opt in with KICK_TEST_CONTAINERS=1 (starts MinIO in
 * Docker), or KICK_TEST_S3_ENDPOINT pointing at a running MinIO with a `test`
 * bucket and the default `minioadmin` credentials.
 */
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startService, type StartedService } from '@forinda/kickjs-testing'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { s3Storage, type S3Storage } from '../src/index'
import { createTusHandler } from '../src/tus'

const endpoint = process.env.KICK_TEST_S3_ENDPOINT
const containers = process.env.KICK_TEST_CONTAINERS === '1'
const MiB = 1024 * 1024

describe.skipIf(!endpoint && !containers)('s3Storage against a live bucket', () => {
  let minio: StartedService | undefined
  let files: S3Storage
  beforeAll(async () => {
    if (!endpoint) minio = await startService('minio')
    files = s3Storage({
      bucket: 'test',
      endpoint: endpoint ?? minio!.url,
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    })
  }, 120_000)
  afterAll(() => minio?.stop())
  const run = `run-${randomUUID()}/`
  const text = async (stream: ReadableStream<Uint8Array> | null) => new Response(stream).text()

  it('stats, streams and lists', async () => {
    await files.put(`${run}a b.txt`, 'hello', { contentType: 'text/plain' })
    await files.put(`${run}dir/c.txt`, 'c')
    await files.put(`${run}dir/d.txt`, 'dd')

    expect(await files.stat(`${run}a b.txt`)).toMatchObject({ size: 5, contentType: 'text/plain' })
    expect(await files.stat(`${run}nope`)).toBeNull()
    expect(await text(await files.getStream(`${run}a b.txt`))).toBe('hello')
    expect(await files.getStream(`${run}nope`)).toBeNull()

    const first = await files.list({ prefix: run, limit: 2 })
    expect(first.files.map((f) => f.key)).toEqual([`${run}a b.txt`, `${run}dir/c.txt`])
    const second = await files.list({ prefix: run, limit: 2, cursor: first.cursor })
    expect(second).toEqual({
      files: [expect.objectContaining({ key: `${run}dir/d.txt`, size: 2 })],
    })
  })

  it('streams a large body up in parts', async () => {
    const chunk = new Uint8Array(MiB).fill(7)
    const body = Readable.from(
      (function* () {
        for (let i = 0; i < 12; i++) yield chunk
      })(),
    )
    await files.put(`${run}big.bin`, body, { contentType: 'application/octet-stream' })
    expect(await files.stat(`${run}big.bin`)).toMatchObject({ size: 12 * MiB })
    expect((await files.get(`${run}big.bin`))!.every((b) => b === 7)).toBe(true)
  })

  it('takes a browser PUT through uploadUrl, at the signed size only', async () => {
    const url = await files.uploadUrl(`${run}up.txt`, { size: 3, contentType: 'text/plain' })
    const wrong = await fetch(url, {
      method: 'PUT',
      body: 'toolong',
      headers: { 'content-type': 'text/plain' },
    })
    expect(wrong.ok).toBe(false)
    const ok = await fetch(url, {
      method: 'PUT',
      body: 'abc',
      headers: { 'content-type': 'text/plain' },
    })
    expect(ok.status).toBe(200)
    expect(await files.stat(`${run}up.txt`)).toMatchObject({ size: 3, contentType: 'text/plain' })
  })

  it('resumes a multipart upload from listParts', async () => {
    const key = `${run}resumable.bin`
    const uploadId = await files.multipart.create(key, { contentType: 'application/pdf' })
    const part = (n: number, size: number) => new Uint8Array(size).fill(n)

    // The first part goes up, then the "page reloads".
    const put1 = await fetch(await files.multipart.partUrl(key, uploadId, 1), {
      method: 'PUT',
      body: part(1, 5 * MiB),
    })
    expect(put1.ok).toBe(true)

    const done = await files.multipart.listParts(key, uploadId)
    expect(done).toEqual([{ partNumber: 1, etag: put1.headers.get('etag'), size: 5 * MiB }])

    const url2 = await files.multipart.partUrl(key, uploadId, 2, { size: 10 })
    const put2 = await fetch(url2, { method: 'PUT', body: part(2, 10) })
    expect(put2.ok).toBe(true)

    await files.multipart.complete(key, uploadId, [
      ...done,
      { partNumber: 2, etag: put2.headers.get('etag')! },
    ])
    expect(await files.stat(key)).toMatchObject({
      size: 5 * MiB + 10,
      contentType: 'application/pdf',
    })
  })

  it('aborts an upload, after which its parts are gone', async () => {
    const key = `${run}aborted.bin`
    const uploadId = await files.multipart.create(key)
    await files.multipart.abort(key, uploadId)
    await expect(files.multipart.listParts(key, uploadId)).rejects.toThrow('404')
  })

  it('putIfAbsent: one of several racing writers wins', async () => {
    const key = `${run}claim`
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => files.putIfAbsent(key, `w${i}`)),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(new TextDecoder().decode((await files.get(key))!)).toBe(`w${results.indexOf(true)}`)
  })

  it('streams parts in parallel', async () => {
    const parallel = s3Storage({
      bucket: 'test',
      endpoint: endpoint ?? minio!.url,
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      partConcurrency: 3,
    })
    const chunks = Array.from({ length: 4 }, (_, i) => new Uint8Array(5 * MiB).fill(i))
    await parallel.put(`${run}parallel.bin`, Readable.from(chunks))
    const bytes = (await files.get(`${run}parallel.bin`))!
    expect(bytes.length).toBe(20 * MiB)
    expect([0, 5, 10, 15].map((at) => bytes[at * MiB])).toEqual([0, 1, 2, 3])
  })

  it('runs tus with unfinished uploads in the bucket, across two instances', async () => {
    const servers: Server[] = []
    const urls: string[] = []
    for (let i = 0; i < 2; i++) {
      const handler = createTusHandler({
        path: '/uploads',
        storage: files,
        partials: files,
        onCreate: (_request, id) => ({ key: `${run}tus/${id}` }),
      })
      const server = createServer((req, res) => handler(req, res, () => res.writeHead(404).end()))
      await new Promise<void>((done) => server.listen(0, done))
      servers.push(server)
      urls.push(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    }
    try {
      const tus = { 'Tus-Resumable': '1.0.0' }
      const created = await fetch(`${urls[0]}/uploads`, {
        method: 'POST',
        headers: { ...tus, 'Upload-Length': String(6 * MiB) },
      })
      const path = created.headers.get('location')!
      const patch = (url: string, offset: number, body: Uint8Array) =>
        fetch(url + path, {
          method: 'PATCH',
          headers: {
            ...tus,
            'Upload-Offset': String(offset),
            'Content-Type': 'application/offset+octet-stream',
          },
          body,
        })
      expect((await patch(urls[0], 0, new Uint8Array(4 * MiB).fill(1))).status).toBe(204)
      expect((await patch(urls[1], 4 * MiB, new Uint8Array(2 * MiB).fill(2))).status).toBe(204)
      const key = `${run}tus/${path.split('/').pop()}`
      const bytes = (await files.get(key))!
      expect(bytes.length).toBe(6 * MiB)
      expect([bytes[0], bytes[6 * MiB - 1]]).toEqual([1, 2])
      // Only the upload's record is left in the bucket.
      const left = (await files.list({ prefix: `tus/${path.split('/').pop()}/` })).files.map((f) =>
        f.key.split('/').pop(),
      )
      expect(left.toSorted()).toEqual(['done', 'info'])
    } finally {
      for (const server of servers) server.close()
    }
  })

  it('cleans up', async () => {
    for (let page = await files.list({ prefix: run }); ;) {
      for (const file of page.files) await files.delete(file.key)
      if (!page.cursor) break
      page = await files.list({ prefix: run, cursor: page.cursor })
    }
    expect((await files.list({ prefix: run })).files).toEqual([])
  })
})
