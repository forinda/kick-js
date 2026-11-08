import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { s3Storage } from '../src/index'
import { presign, signV4 } from '../src/s3'

// The examples in AWS's "Authenticating Requests (AWS Signature Version 4)" docs.
const aws = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  date: new Date('2013-05-24T00:00:00Z'),
}
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('SigV4', () => {
  it("matches AWS's signed GET with a Range header", async () => {
    const url = new URL('https://examplebucket.s3.amazonaws.com/test.txt')
    const headers = {
      range: 'bytes=0-9',
      'x-amz-content-sha256': EMPTY,
      'x-amz-date': '20130524T000000Z',
    }
    expect(await signV4('GET', url, headers, EMPTY, aws)).toEqual({
      signature: 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
      credential: 'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request',
      signedHeaders: 'host;range;x-amz-content-sha256;x-amz-date',
    })
  })

  it("matches AWS's presigned URL", async () => {
    const url = await presign(
      new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      86400,
      aws,
    )
    expect(url).toContain(
      'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    )
    expect(url).toContain(
      'X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request',
    )
  })
})

describe('s3Storage', () => {
  const options = { bucket: 'files', accessKeyId: 'id', secretAccessKey: 'secret' }

  function bucket() {
    const objects = new Map<string, Uint8Array>()
    const calls: Request[] = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init)
      calls.push(req)
      const path = new URL(req.url).pathname
      if (req.method === 'PUT') objects.set(path, new Uint8Array(await req.arrayBuffer()))
      if (req.method === 'DELETE') objects.delete(path)
      const body = objects.get(path)
      if (!body && req.method !== 'PUT') return new Response(null, { status: 404 })
      return new Response(req.method === 'GET' ? body : null, { status: 200 })
    }) as unknown as typeof globalThis.fetch
    return { fetch, calls }
  }

  describe('ensureBucket', () => {
    function server(responses: Array<[number, string?]>) {
      const calls: Array<{ method: string; url: string; body: string }> = []
      const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const req = new Request(input, init)
        calls.push({ method: req.method, url: req.url, body: await req.text() })
        const [status, text] = responses.shift()!
        return new Response(req.method === 'HEAD' ? null : (text ?? null), { status })
      }) as unknown as typeof globalThis.fetch
      return { fetch, calls }
    }

    it('leaves a bucket that exists alone', async () => {
      const { fetch, calls } = server([[200]])
      const files = s3Storage({ ...options, endpoint: 'http://localhost:9000', fetch })
      expect(await files.ensureBucket()).toBe(false)
      expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
        'HEAD http://localhost:9000/files/',
      ])
    })

    it('creates a missing bucket, naming the region except us-east-1', async () => {
      const east = server([[404], [200]])
      const files = s3Storage({ ...options, endpoint: 'http://localhost:9000', fetch: east.fetch })
      expect(await files.ensureBucket()).toBe(true)
      expect(east.calls[1]).toMatchObject({
        method: 'PUT',
        url: 'http://localhost:9000/files/',
        body: '',
      })

      const eu = server([[404], [200]])
      await s3Storage({ ...options, region: 'eu-west-1', fetch: eu.fetch }).ensureBucket()
      expect(eu.calls[1]!.body).toContain('<LocationConstraint>eu-west-1</LocationConstraint>')
    })

    it('treats losing a race to create it as existing', async () => {
      const { fetch } = server([
        [404],
        [409, '<Error><Code>BucketAlreadyOwnedByYou</Code></Error>'],
      ])
      const files = s3Storage({ ...options, endpoint: 'http://localhost:9000', fetch })
      expect(await files.ensureBucket()).toBe(false)
    })

    it('throws when the bucket belongs to someone else or access is denied', async () => {
      const taken = server([[404], [409, '<Error><Code>BucketAlreadyExists</Code></Error>']])
      await expect(
        s3Storage({
          ...options,
          endpoint: 'http://localhost:9000',
          fetch: taken.fetch,
        }).ensureBucket(),
      ).rejects.toThrow(/PUT 'files' failed with 409: .*BucketAlreadyExists/)
      const denied = server([[403]])
      await expect(
        s3Storage({
          ...options,
          endpoint: 'http://localhost:9000',
          fetch: denied.fetch,
        }).ensureBucket(),
      ).rejects.toThrow(/HEAD 'files' failed with 403/)
    })
  })

  it('puts, gets, checks and deletes over signed requests', async () => {
    const { fetch, calls } = bucket()
    const files = s3Storage({ ...options, endpoint: 'http://localhost:9000/', fetch })

    expect(await files.get('a/b c.txt')).toBeNull()
    await files.put('a/b c.txt', 'hello', { contentType: 'text/plain' })
    expect(new TextDecoder().decode((await files.get('a/b c.txt'))!)).toBe('hello')
    expect(await files.exists('a/b c.txt')).toBe(true)
    await files.delete('a/b c.txt')
    await files.delete('a/b c.txt')
    expect(await files.exists('a/b c.txt')).toBe(false)

    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toBe('http://localhost:9000/files/a/b%20c.txt')
    expect(put.headers.get('content-type')).toBe('text/plain')
    expect(put.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    )
  })

  it('addresses AWS buckets virtual-hosted and signs URLs', async () => {
    const { fetch, calls } = bucket()
    const files = s3Storage({ ...options, region: 'eu-west-1', sessionToken: 'tok', fetch })
    await files.put('x.png', new Uint8Array([1]))
    expect(calls[0].url).toBe('https://files.s3.eu-west-1.amazonaws.com/x.png')
    expect(calls[0].headers.get('authorization')).toContain('x-amz-security-token')

    const link = new URL(await files.url('x.png', { expiresIn: 60 }))
    expect(link.searchParams.get('X-Amz-Expires')).toBe('60')
    expect(link.searchParams.get('X-Amz-Security-Token')).toBe('tok')
    await expect(files.url('x.png', { expiresIn: 8 * 86400 })).rejects.toThrow('expiresIn')
  })

  it('switches addressing style with forcePathStyle', async () => {
    const urls = async (extra: object) => {
      const { fetch, calls } = bucket()
      await s3Storage({ ...options, ...extra, fetch }).put('k', 'x')
      return calls[0].url
    }
    expect(await urls({ region: 'eu-west-1', forcePathStyle: true })).toBe(
      'https://s3.eu-west-1.amazonaws.com/files/k',
    )
    expect(await urls({ endpoint: 'https://storage.example.com/', forcePathStyle: false })).toBe(
      'https://files.storage.example.com/k',
    )
    expect(await urls({ endpoint: 'http://localhost:9000/base' })).toBe(
      'http://localhost:9000/base/files/k',
    )
  })

  it('throws on other errors with the status and body', async () => {
    const fetch = (async () =>
      new Response('<Error>AccessDenied</Error>', { status: 403 })) as typeof globalThis.fetch
    const files = s3Storage({ ...options, fetch })
    await expect(files.get('x')).rejects.toThrow("GET 'x' failed with 403: <Error>AccessDenied")
  })

  it('never lets a key address the bucket itself', async () => {
    const { fetch, calls } = bucket()
    const files = s3Storage({ ...options, fetch })
    for (const call of [
      () => files.get(''),
      () => files.put('', 'x'),
      () => files.delete(''),
      () => files.stat(''),
      () => files.getStream(''),
      () => files.url(''),
      () => files.uploadUrl(''),
      () => files.multipart.create(''),
    ]) {
      await expect(call()).rejects.toThrow('invalid key')
    }
    expect(calls).toEqual([])
  })

  it('requires its credentials', () => {
    expect(() => s3Storage({ ...options, secretAccessKey: '' })).toThrow('secretAccessKey')
    expect(() => s3Storage({ ...options, credentials: () => options })).toThrow('not both')
  })

  it('signs with keys from a credentials provider, fetched per request', async () => {
    const { fetch, calls } = bucket()
    let n = 0
    const files = s3Storage({
      bucket: 'files',
      endpoint: 'http://s3.test',
      fetch,
      credentials: async () => ({
        accessKeyId: `role-${++n}`,
        secretAccessKey: 'secret',
        sessionToken: 'token',
      }),
    })
    await files.put('k', 'x')
    await files.get('k')
    expect(
      calls.map((c) => c.headers.get('authorization')!.match(/Credential=([^/]+)/)![1]),
    ).toEqual(['role-1', 'role-2'])
    expect(calls[0].headers.get('x-amz-security-token')).toBe('token')
    const url = new URL(await files.url('k'))
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^role-3\//)
    expect(url.searchParams.get('X-Amz-Security-Token')).toBe('token')
  })

  it('aborts a request the bucket does not answer within timeoutMs', async () => {
    const fetch = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
      )) as unknown as typeof globalThis.fetch
    const files = s3Storage({ ...options, endpoint: 'http://s3.test', fetch, timeoutMs: 20 })
    await expect(files.get('slow.png')).rejects.toThrow("GET 'slow.png' got no answer within 20 ms")
    expect(() => s3Storage({ ...options, timeoutMs: 0 })).toThrow('timeoutMs')
  })

  it('sends a Range header for a byte range; 416 reads as empty', async () => {
    const calls: Request[] = []
    const replies = [new Response('234', { status: 206 }), new Response('', { status: 416 })]
    const fetch = (async (input: string, init: RequestInit) => {
      calls.push(new Request(input, init))
      return replies.shift()!
    }) as unknown as typeof globalThis.fetch
    const files = s3Storage({ ...options, endpoint: 'http://s3.test', fetch })
    expect(await new Response(await files.getStream('f', { start: 2, end: 4 })).text()).toBe('234')
    expect(calls[0].headers.get('range')).toBe('bytes=2-4')
    expect(await new Response(await files.getStream('f', { start: 99 })).text()).toBe('')
    expect(calls[1].headers.get('range')).toBe('bytes=99-')
  })

  it('refuses a whole file sent back for a byte range', async () => {
    const fetch = (async () => new Response('0123456789')) as unknown as typeof globalThis.fetch
    const files = s3Storage({ ...options, endpoint: 'http://s3.test', fetch })
    await expect(files.getStream('f', { start: 2, end: 4 })).rejects.toThrow('whole file')
    expect(await new Response(await files.getStream('f')).text()).toBe('0123456789')
  })

  it('signs response headers into a GET URL', async () => {
    const files = s3Storage(options)
    const url = new URL(
      await files.url('a.png', {
        contentType: 'image/png',
        contentDisposition: 'inline; filename="a.png"',
        cacheControl: 'public, max-age=600',
      }),
    )
    expect(url.searchParams.get('response-content-type')).toBe('image/png')
    expect(url.searchParams.get('response-content-disposition')).toBe('inline; filename="a.png"')
    expect(url.searchParams.get('response-cache-control')).toBe('public, max-age=600')
  })

  describe('responses', () => {
    const scripted = (...replies: Array<[number, string, Record<string, string>?]>) => {
      const calls: Request[] = []
      const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push(new Request(input, init))
        const [status, body, headers] = replies.shift()!
        return new Response(status === 204 ? null : body, { status, headers })
      }) as unknown as typeof globalThis.fetch
      return { files: s3Storage({ ...options, endpoint: 'http://s3.test', fetch }), calls }
    }

    it('reads a ListObjectsV2 page, unescaping keys', async () => {
      const { files, calls } = scripted([
        200,
        `<ListBucketResult><IsTruncated>true</IsTruncated>
          <Contents><Key>a/R&amp;D &lt;1&gt;.txt</Key><LastModified>2026-01-02T03:04:05.000Z</LastModified><Size>12</Size></Contents>
          <NextContinuationToken>tok/en=</NextContinuationToken></ListBucketResult>`,
      ])
      expect(await files.list({ prefix: 'a/', limit: 1, cursor: 'prev' })).toEqual({
        files: [{ key: 'a/R&D <1>.txt', size: 12, lastModified: new Date('2026-01-02T03:04:05Z') }],
        cursor: 'tok/en=',
      })
      const url = new URL(calls[0].url)
      expect(url.pathname).toBe('/files/')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        'list-type': '2',
        'max-keys': '1',
        prefix: 'a/',
        'continuation-token': 'prev',
      })
    })

    it('throws when starting a multipart upload returns no UploadId', async () => {
      const { files } = scripted([200, '<Unexpected/>'])
      await expect(files.multipart.create('k')).rejects.toThrow('returned no UploadId')
    })

    it('reads CommonPrefixes with a delimiter, not the echoed request prefix', async () => {
      const { files, calls } = scripted([
        200,
        `<ListBucketResult><Prefix>a/</Prefix><Delimiter>/</Delimiter><IsTruncated>false</IsTruncated>
          <Contents><Key>a/1</Key><LastModified>2026-01-01T00:00:00Z</LastModified><Size>1</Size></Contents>
          <CommonPrefixes><Prefix>a/b/</Prefix></CommonPrefixes>
          <CommonPrefixes><Prefix>a/R&amp;D/</Prefix></CommonPrefixes></ListBucketResult>`,
      ])
      const page = await files.list({ prefix: 'a/', delimiter: '/' })
      expect(page.prefixes).toEqual(['a/b/', 'a/R&D/'])
      expect(page.files.map((f) => f.key)).toEqual(['a/1'])
      expect(new URL(calls[0].url).searchParams.get('delimiter')).toBe('/')
    })

    it('follows listParts pages', async () => {
      const part = (n: number) =>
        `<Part><PartNumber>${n}</PartNumber><ETag>&quot;e${n}&quot;</ETag><Size>5</Size></Part>`
      const { files } = scripted(
        [
          200,
          `<R><IsTruncated>true</IsTruncated><NextPartNumberMarker>1</NextPartNumberMarker>${part(1)}</R>`,
        ],
        [200, `<R><IsTruncated>false</IsTruncated>${part(2)}</R>`],
      )
      expect(await files.multipart.listParts('k', 'u')).toEqual([
        { partNumber: 1, etag: '"e1"', size: 5 },
        { partNumber: 2, etag: '"e2"', size: 5 },
      ])
    })

    it('throws when complete answers 200 with an error body', async () => {
      const { files, calls } = scripted([
        200,
        '<Error><Code>InvalidPart</Code><Message>gone</Message></Error>',
      ])
      await expect(
        files.multipart.complete('k', 'u', [{ partNumber: 1, etag: '"e"' }]),
      ).rejects.toThrow('InvalidPart gone')
      expect(await calls[0].text()).toBe(
        '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&#34;e&#34;</ETag></Part></CompleteMultipartUpload>',
      )
    })

    it('aborts the multipart upload when a streamed part fails', async () => {
      const { files, calls } = scripted(
        [200, '<R><UploadId>up-1</UploadId></R>'],
        [400, 'boom'],
        [204, ''],
      )
      const big = new Uint8Array(5 * 1024 * 1024)
      await expect(files.put('k', Readable.from([big]))).rejects.toThrow('400')
      expect(calls.map((c) => `${c.method} ${new URL(c.url).search}`)).toEqual([
        'POST ?uploads=',
        'PUT ?partNumber=1&uploadId=up-1',
        'DELETE ?uploadId=up-1',
      ])
    })

    it('uploads stream parts in parallel, up to partConcurrency', async () => {
      let active = 0
      let peak = 0
      let completeBody = ''
      let released = false
      let release!: () => void
      const gate = new Promise<void>((done) => {
        release = () => {
          released = true
          done()
        }
      })
      const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const req = new Request(input, init)
        const url = new URL(req.url)
        if (req.method === 'POST' && url.searchParams.has('uploads')) {
          return new Response('<R><UploadId>up</UploadId></R>')
        }
        if (req.method === 'POST') {
          completeBody = await req.text()
          return new Response('<CompleteMultipartUploadResult/>')
        }
        active++
        peak = Math.max(peak, active)
        const n = Number(url.searchParams.get('partNumber'))
        // Hold the first parts until three are in flight at once, so the peak
        // doesn't depend on how fast this machine hashes 5 MiB (a fallback
        // releases them, and the test fails, if three never get there).
        if (!released) {
          if (active === 3) release()
          else await Promise.race([gate, new Promise((done) => setTimeout(done, 2000))])
        }
        // Later parts finish first, so completion order differs from part order.
        await new Promise((done) => setTimeout(done, 20 - n * 2))
        active--
        return new Response(null, { headers: { etag: `"e${n}"` } })
      }) as unknown as typeof globalThis.fetch
      const part = new Uint8Array(5 * 1024 * 1024)
      await s3Storage({ ...options, fetch, partConcurrency: 3 }).put(
        'k',
        Readable.from(Array.from({ length: 8 }, () => part)),
      )
      expect(peak).toBe(3)
      expect([...completeBody.matchAll(/<PartNumber>(\d+)/g)].map((m) => Number(m[1]))).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ])
    })

    it('uploadForm signs a POST policy with the size range and type', async () => {
      const { files } = scripted()
      const form = await files.uploadForm('up/a.pdf', {
        maxSize: 1000,
        minSize: 1,
        contentType: 'application/pdf',
        expiresIn: 60,
      })
      expect(form.url).toBe('http://s3.test/files/')
      expect(form.fields).toMatchObject({ key: 'up/a.pdf', 'Content-Type': 'application/pdf' })
      expect(form.fields['x-amz-signature']).toMatch(/^[0-9a-f]{64}$/)
      const policy = JSON.parse(atob(form.fields.policy))
      expect(policy.conditions).toContainEqual(['content-length-range', 1, 1000])
      expect(policy.conditions).toContainEqual({ bucket: 'files' })
      expect(policy.conditions).toContainEqual({ key: 'up/a.pdf' })
      expect(new Date(policy.expiration).getTime() - Date.now()).toBeLessThanOrEqual(60_000)

      // A family would admit image/svg+xml: exact types only.
      for (const contentType of ['image/', 'image/*', 'image/png; x=1', 'text/html\r\nX: y']) {
        await expect(files.uploadForm('up/b', { maxSize: 10, contentType })).rejects.toThrow(
          'exact type',
        )
      }
      await expect(files.uploadForm('x', { maxSize: 1, minSize: 2 })).rejects.toThrow('sizes')
      await expect(files.uploadForm('../x', { maxSize: 1 })).rejects.toThrow('invalid key')
    })

    it('refuses a part size under S3 minimum', () => {
      expect(() => s3Storage({ ...options, partSize: 1024 })).toThrow('partSize')
      expect(() => s3Storage({ ...options, partConcurrency: 0 })).toThrow('partConcurrency')
    })

    it('putIfAbsent sends If-None-Match and reads 412 / 409 as taken', async () => {
      const { files, calls } = scripted([200, ''], [412, ''], [409, ''])
      expect(await files.putIfAbsent('k', 'a')).toBe(true)
      expect(await files.putIfAbsent('k', 'b')).toBe(false)
      expect(await files.putIfAbsent('k', 'c')).toBe(false)
      expect(calls[0].headers.get('if-none-match')).toBe('*')
    })

    it('putIfAbsent streams a large body in parts, conditional on completing', async () => {
      const big = () => Readable.from([new Uint8Array(5 * 1024 * 1024), new Uint8Array(10)])
      const won = scripted(
        [404, ''], // HEAD: not there yet
        [200, '<R><UploadId>u1</UploadId></R>'],
        [200, '', { etag: '"p1"' }],
        [200, '', { etag: '"p2"' }],
        [200, '<CompleteMultipartUploadResult/>'],
      )
      expect(await won.files.putIfAbsent('k', big())).toBe(true)
      expect(won.calls.at(-1)!.headers.get('if-none-match')).toBe('*')

      const lost = scripted(
        [404, ''],
        [200, '<R><UploadId>u2</UploadId></R>'],
        [200, '', { etag: '"p1"' }],
        [200, '', { etag: '"p2"' }],
        [412, '<Error><Code>PreconditionFailed</Code></Error>'],
        [204, ''],
      )
      expect(await lost.files.putIfAbsent('k', big())).toBe(false)
      expect(lost.calls.at(-1)!.method).toBe('DELETE') // the upload is aborted

      // Already there: found before uploading anything.
      const there = scripted([200, ''])
      expect(await there.files.putIfAbsent('k', big())).toBe(false)
      expect(there.calls.map((c) => c.method)).toEqual(['HEAD'])
    })

    it('compose copies one source with CopyObject, signing the copy headers', async () => {
      const { files, calls } = scripted(
        [200, '', { 'content-length': '10' }],
        [200, '<CopyObjectResult><ETag>"x"</ETag></CopyObjectResult>'],
      )
      await files.compose('dest', ['tus/a b'], { contentType: 'text/plain' })
      const copy = calls[1]
      expect(copy.method).toBe('PUT')
      expect(copy.headers.get('x-amz-copy-source')).toBe('/files/tus/a%20b')
      expect(copy.headers.get('content-type')).toBe('text/plain')
      expect(copy.headers.get('authorization')).toContain('x-amz-copy-source')
    })

    it('compose copies big sources in even ranges of at most 5 GiB', async () => {
      const GiB = 1024 ** 3
      const calls: Request[] = []
      // Answered by request, not by order: the sources are checked in parallel.
      const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const req = new Request(input, init)
        calls.push(req)
        const url = new URL(req.url)
        if (req.method === 'HEAD') {
          const size = url.pathname.endsWith('/big') ? 6 * GiB : 7
          return new Response(null, { headers: { 'content-length': String(size) } })
        }
        if (url.searchParams.has('uploads')) return new Response('<R><UploadId>u</UploadId></R>')
        if (req.method === 'PUT') {
          return new Response(
            `<CopyPartResult><ETag>"${url.searchParams.get('partNumber')}"</ETag></CopyPartResult>`,
          )
        }
        return new Response('<CompleteMultipartUploadResult/>')
      }) as unknown as typeof globalThis.fetch
      await s3Storage({ ...options, endpoint: 'http://s3.test', fetch }).compose('dest', [
        'big',
        'tail',
      ])
      const ranges = calls
        .filter((c) => c.headers.get('x-amz-copy-source-range'))
        .map(
          (c) =>
            `${c.headers.get('x-amz-copy-source')} ${c.headers.get('x-amz-copy-source-range')}`,
        )
        .toSorted()
      expect(ranges).toEqual([
        `/files/big bytes=0-${3 * GiB - 1}`,
        `/files/big bytes=${3 * GiB}-${6 * GiB - 1}`,
        '/files/tail bytes=0-6',
      ])
      expect(await calls.at(-1)!.text()).toContain('<PartNumber>3</PartNumber>')
    })

    it('compose streams through when a source before the last is under 5 MiB', async () => {
      const { files, calls } = scripted(
        [200, '', { 'content-length': '3' }],
        [200, '', { 'content-length': '3' }],
        [200, 'abc'],
        [200, 'def'],
        [200, ''],
      )
      await files.compose('dest', ['a', 'b'])
      expect(calls.map((c) => c.method)).toEqual(['HEAD', 'HEAD', 'GET', 'GET', 'PUT'])
      expect(await calls[4].text()).toBe('abcdef')
    })

    it('sends a small stream as one PUT', async () => {
      const { files, calls } = scripted([200, ''])
      await files.put('k', Readable.from([new Uint8Array([1, 2])]))
      expect(calls.map((c) => c.method)).toEqual(['PUT'])
    })

    it('signs size and type into an upload URL', async () => {
      const { files } = scripted()
      const url = new URL(await files.uploadUrl('k', { size: 3, contentType: 'image/png' }))
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host')
      await expect(files.uploadUrl('k', { size: -1 })).rejects.toThrow('size')
      await expect(files.multipart.partUrl('k', 'u', 10_001)).rejects.toThrow('partNumber')
    })
  })
})

describe('s3Storage serverSideEncryption', () => {
  const kms = { type: 'aws:kms', keyId: 'arn:aws:kms:eu-west-1:1:key/abc' } as const
  function server(
    serverSideEncryption: { type: 'AES256' } | { type: 'aws:kms'; keyId?: string },
    ...replies: Array<[number, string, Record<string, string>?]>
  ) {
    const calls: Request[] = []
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(new Request(input, init))
      const [status, body, headers] = replies.shift() ?? [200, '']
      return new Response(status === 204 ? null : body, { status, headers })
    }) as unknown as typeof globalThis.fetch
    const files = s3Storage({
      bucket: 'files',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      endpoint: 'http://s3.test',
      serverSideEncryption,
      fetch,
    })
    return { files, calls }
  }
  /** The encryption headers a request sent, and whether they were signed. */
  const sent = (req: Request) => ({
    sse: req.headers.get('x-amz-server-side-encryption'),
    key: req.headers.get('x-amz-server-side-encryption-aws-kms-key-id'),
    signed: /SignedHeaders=[^,]*x-amz-server-side-encryption/.test(
      req.headers.get('authorization') ?? '',
    ),
  })

  it('sends signed headers on put, putIfAbsent and copies', async () => {
    const { files, calls } = server(
      kms,
      [200, ''],
      [200, ''],
      [200, '', { 'content-length': '10' }],
      [200, '<CopyObjectResult><ETag>"x"</ETag></CopyObjectResult>'],
    )
    await files.put('a', 'x')
    await files.putIfAbsent('b', 'y')
    await files.compose('c', ['a'])
    const expected = { sse: 'aws:kms', key: kms.keyId, signed: true }
    expect(sent(calls[0]!)).toEqual(expected)
    expect(sent(calls[1]!)).toEqual(expected)
    expect(calls[2]!.method).toBe('HEAD')
    expect(sent(calls[3]!)).toEqual(expected) // the CopyObject
  })

  it('starts a multipart upload encrypted; parts carry no headers', async () => {
    const { files, calls } = server(
      { type: 'AES256' },
      [200, '<R><UploadId>u1</UploadId></R>'],
      [200, '', { etag: '"p1"' }],
      [200, '', { etag: '"p2"' }],
      [200, '<CompleteMultipartUploadResult/>'],
    )
    await files.put('big', Readable.from([new Uint8Array(5 * 1024 * 1024), new Uint8Array(10)]))
    expect(sent(calls[0]!)).toEqual({ sse: 'AES256', key: null, signed: true })
    expect(calls.slice(1).map((c) => sent(c).sse)).toEqual([null, null, null])
  })

  it('puts the headers in an upload form and its policy, not in uploadUrl', async () => {
    const { files } = server(kms)
    const form = await files.uploadForm('up/a', { maxSize: 10 })
    expect(form.fields['x-amz-server-side-encryption']).toBe('aws:kms')
    expect(form.fields['x-amz-server-side-encryption-aws-kms-key-id']).toBe(kms.keyId)
    const policy = JSON.parse(atob(form.fields.policy!))
    expect(policy.conditions).toContainEqual({ 'x-amz-server-side-encryption': 'aws:kms' })
    expect(await files.uploadUrl('up/b')).not.toContain('server-side-encryption')
  })

  it('leaves the key out for the default KMS key', async () => {
    const { files, calls } = server({ type: 'aws:kms' })
    await files.put('a', 'x')
    expect(sent(calls[0]!)).toEqual({ sse: 'aws:kms', key: null, signed: true })
  })

  it('refuses settings S3 would reject', () => {
    const base = { bucket: 'files', accessKeyId: 'id', secretAccessKey: 'secret' }
    expect(() =>
      s3Storage({ ...base, serverSideEncryption: { type: 'AES256', keyId: 'k' } as never }),
    ).toThrow("keyId is only for type 'aws:kms'")
    expect(() =>
      s3Storage({ ...base, serverSideEncryption: { type: 'aws:kms', keyId: ' ' } }),
    ).toThrow('non-empty')
    expect(() => s3Storage({ ...base, serverSideEncryption: { type: 'sse-c' } as never })).toThrow(
      "'AES256' or 'aws:kms'",
    )
  })
})

describe('s3Storage acl', () => {
  function server(...replies: Array<[number, string, Record<string, string>?]>) {
    const calls: Request[] = []
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(new Request(input, init))
      const [status, body, headers] = replies.shift() ?? [200, '']
      return new Response(status === 204 ? null : body, { status, headers })
    }) as unknown as typeof globalThis.fetch
    const files = s3Storage({
      bucket: 'files',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      endpoint: 'http://s3.test',
      acl: 'public-read',
      fetch,
    })
    return { files, calls }
  }
  const sent = (req: Request) => ({
    acl: req.headers.get('x-amz-acl'),
    signed: /SignedHeaders=[^,]*x-amz-acl/.test(req.headers.get('authorization') ?? ''),
  })

  it('sends a signed x-amz-acl on put, putIfAbsent, copies and multipart starts', async () => {
    const { files, calls } = server(
      [200, ''],
      [200, ''],
      [200, '', { 'content-length': '10' }],
      [200, '<CopyObjectResult><ETag>"x"</ETag></CopyObjectResult>'],
      [200, '<R><UploadId>u1</UploadId></R>'],
    )
    await files.put('a', 'x')
    await files.putIfAbsent('b', 'y')
    await files.compose('c', ['a'])
    await files.multipart.create('d')
    const expected = { acl: 'public-read', signed: true }
    expect(sent(calls[0]!)).toEqual(expected)
    expect(sent(calls[1]!)).toEqual(expected)
    expect(sent(calls[3]!)).toEqual(expected) // the CopyObject
    expect(sent(calls[4]!)).toEqual(expected)
  })

  it('signs it into upload URLs and puts it in upload forms as `acl`', async () => {
    const { files } = server()
    const url = new URL(await files.uploadUrl('up/a'))
    expect(url.searchParams.get('x-amz-acl')).toBe('public-read')
    const form = await files.uploadForm('up/b', { maxSize: 10 })
    expect(form.fields.acl).toBe('public-read')
    expect(form.fields['x-amz-acl']).toBeUndefined()
    expect(JSON.parse(atob(form.fields.policy!)).conditions).toContainEqual({ acl: 'public-read' })
  })

  it('sends nothing without it, and refuses an unknown ACL', async () => {
    const calls: Request[] = []
    const files = s3Storage({
      bucket: 'files',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push(new Request(input, init))
        return new Response('')
      }) as unknown as typeof globalThis.fetch,
    })
    await files.put('a', 'x')
    expect(calls[0]!.headers.get('x-amz-acl')).toBeNull()
    expect(await files.uploadUrl('a')).not.toContain('x-amz-acl')
    expect(() =>
      s3Storage({ bucket: 'b', accessKeyId: 'i', secretAccessKey: 's', acl: 'public' as never }),
    ).toThrow('acl must be one of private, public-read')
  })
})

describe('s3Storage acl per call', () => {
  it('overrides the storage default on each kind of write', async () => {
    const calls: Request[] = []
    const replies: Array<[number, string, Record<string, string>?]> = [
      [200, ''],
      [200, ''],
      [200, '<R><UploadId>u1</UploadId></R>'],
      [200, '', { 'content-length': '10' }],
      [200, '<CopyObjectResult><ETag>"x"</ETag></CopyObjectResult>'],
    ]
    const files = s3Storage({
      bucket: 'files',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      endpoint: 'http://s3.test',
      acl: 'public-read',
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push(new Request(input, init))
        const [status, body, headers] = replies.shift() ?? [200, '']
        return new Response(body, { status, headers })
      }) as unknown as typeof globalThis.fetch,
    })
    await files.put('a', 'x', { acl: 'private' })
    await files.putIfAbsent('b', 'y', { acl: 'private' })
    await files.multipart.create('c', { acl: 'private' })
    await files.compose('d', ['a'], { acl: 'private' })
    expect(calls.map((c) => c.headers.get('x-amz-acl'))).toEqual([
      'private',
      'private',
      'private',
      null, // the HEAD of the source
      'private',
    ])
    const url = new URL(await files.uploadUrl('e', { acl: 'private' }))
    expect(url.searchParams.get('x-amz-acl')).toBe('private')
    expect((await files.uploadForm('f', { maxSize: 1, acl: 'private' })).fields.acl).toBe('private')
    // Without one, the storage's.
    expect((await files.uploadForm('g', { maxSize: 1 })).fields.acl).toBe('public-read')
    await expect(files.put('h', 'x', { acl: 'nope' as never })).rejects.toThrow(
      'acl must be one of',
    )
  })

  it('sends one on a storage that has none', async () => {
    const calls: Request[] = []
    const files = s3Storage({
      bucket: 'files',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push(new Request(input, init))
        return new Response('')
      }) as unknown as typeof globalThis.fetch,
    })
    await files.put('a', 'x', { acl: 'public-read' })
    expect(calls[0]!.headers.get('x-amz-acl')).toBe('public-read')
  })
})

describe('s3Storage retries', () => {
  function server(maxAttempts: number | undefined, ...replies: Array<number | Error>) {
    const calls: Request[] = []
    const files = s3Storage({
      bucket: 'files',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      endpoint: 'http://s3.test',
      ...(maxAttempts ? { maxAttempts } : {}),
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push(new Request(input, init))
        const reply = replies.shift() ?? 200
        if (reply instanceof Error) throw reply
        return new Response(reply === 204 ? null : 'body', { status: reply })
      }) as unknown as typeof globalThis.fetch,
    })
    return { files, calls }
  }
  // No waiting between tries.
  beforeEach(() => void vi.spyOn(Math, 'random').mockReturnValue(0))
  afterEach(() => vi.restoreAllMocks())

  it('sends again on 500, 503 and network errors, re-signed, up to maxAttempts', async () => {
    const { files, calls } = server(undefined, 503, new TypeError('fetch failed'), 200)
    await files.put('a', 'x')
    expect(calls).toHaveLength(3)
    expect(await calls[2]!.text()).toBe('x') // the body is sent each time
    const twice = server(2, 500, 500, 200)
    await expect(twice.files.put('a', 'x')).rejects.toThrow('500')
    expect(twice.calls).toHaveLength(2)
  })

  it('leaves 4xx and 501 alone, and sends once with maxAttempts: 1', async () => {
    for (const status of [400, 403, 501]) {
      const { files, calls } = server(undefined, status)
      await expect(files.put('a', 'x')).rejects.toThrow(String(status))
      expect(calls).toHaveLength(1)
    }
    const once = server(1, 503)
    await expect(once.files.put('a', 'x')).rejects.toThrow('503')
    expect(once.calls).toHaveLength(1)
  })

  it('retries a create-only write on 503 only', async () => {
    const throttled = server(undefined, 503, 200)
    expect(await throttled.files.putIfAbsent('a', 'x')).toBe(true)
    expect(throttled.calls).toHaveLength(2)
    // After a 500 or no answer, the write may have landed: a retry would see it taken.
    const failed = server(undefined, 500)
    await expect(failed.files.putIfAbsent('a', 'x')).rejects.toThrow('500')
    expect(failed.calls).toHaveLength(1)
    const dropped = server(undefined, new TypeError('fetch failed'))
    await expect(dropped.files.putIfAbsent('a', 'x')).rejects.toThrow('fetch failed')
    expect(dropped.calls).toHaveLength(1)
  })

  it('refuses a maxAttempts below 1', () => {
    expect(() =>
      s3Storage({ bucket: 'b', accessKeyId: 'i', secretAccessKey: 's', maxAttempts: 0 }),
    ).toThrow('maxAttempts')
  })
})

describe('s3Storage per-file headers and metadata', () => {
  function server(...replies: Array<[number, string, Record<string, string>?]>) {
    const calls: Request[] = []
    const files = s3Storage({
      bucket: 'files',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      endpoint: 'http://s3.test',
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push(new Request(input, init))
        const [status, body, headers] = replies.shift() ?? [200, '']
        return new Response(body, { status, headers })
      }) as unknown as typeof globalThis.fetch,
    })
    return { files, calls }
  }
  const options = {
    cacheControl: 'public, max-age=31536000, immutable',
    contentDisposition: 'attachment; filename="r.pdf"',
    contentEncoding: 'gzip',
    contentLanguage: 'en',
    metadata: { Owner: 'u1', 'trace-id': 't9' },
  }

  it('signs them on put, multipart starts and copies', async () => {
    const { files, calls } = server(
      [200, ''],
      [200, '<R><UploadId>u1</UploadId></R>'],
      [200, '', { 'content-length': '10' }],
      [200, '<CopyObjectResult><ETag>"x"</ETag></CopyObjectResult>'],
    )
    await files.put('a', 'x', options)
    await files.multipart.create('b', options)
    await files.compose('c', ['a'], options)
    for (const req of [calls[0]!, calls[1]!, calls[3]!]) {
      expect(req.headers.get('cache-control')).toBe(options.cacheControl)
      expect(req.headers.get('content-disposition')).toBe(options.contentDisposition)
      expect(req.headers.get('content-encoding')).toBe('gzip')
      expect(req.headers.get('content-language')).toBe('en')
      expect(req.headers.get('x-amz-meta-owner')).toBe('u1')
      expect(req.headers.get('x-amz-meta-trace-id')).toBe('t9')
      expect(req.headers.get('authorization')).toMatch(
        /SignedHeaders=[^,]*cache-control;[^,]*content-disposition;content-encoding;content-language;[^,]*x-amz-meta-owner;x-amz-meta-trace-id/,
      )
    }
  })

  it('puts metadata in an upload URL query and signs the rest as headers', async () => {
    const { files } = server()
    const url = new URL(await files.uploadUrl('a', options))
    expect(url.searchParams.get('x-amz-meta-owner')).toBe('u1')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'cache-control;content-disposition;content-encoding;content-language;host',
    )
  })

  it('names them as form fields in an upload form and its policy', async () => {
    const { files } = server()
    const form = await files.uploadForm('a', { maxSize: 10, ...options })
    expect(form.fields['Cache-Control']).toBe(options.cacheControl)
    expect(form.fields['Content-Disposition']).toBe(options.contentDisposition)
    expect(form.fields['x-amz-meta-owner']).toBe('u1')
    const { conditions } = JSON.parse(atob(form.fields.policy!))
    expect(conditions).toContainEqual({ 'Cache-Control': options.cacheControl })
    expect(conditions).toContainEqual({ 'x-amz-meta-trace-id': 't9' })
  })

  it('returns them from stat()', async () => {
    const { files } = server([
      200,
      '',
      {
        'content-length': '3',
        'cache-control': 'no-cache',
        'content-language': 'en',
        'x-amz-meta-owner': 'u1',
      },
    ])
    expect(await files.stat('a')).toMatchObject({
      size: 3,
      cacheControl: 'no-cache',
      contentLanguage: 'en',
      metadata: { owner: 'u1' },
    })
  })

  it('refuses what S3 would reject', async () => {
    const { files } = server()
    await expect(files.put('a', 'x', { metadata: { 'bad name': 'v' } })).rejects.toThrow(
      "metadata name 'bad name'",
    )
    await expect(files.put('a', 'x', { metadata: { n: 'café' } })).rejects.toThrow(
      'printable ASCII',
    )
    await expect(files.put('a', 'x', { metadata: { n: 'x'.repeat(2048) } })).rejects.toThrow('2 KB')
    await expect(files.put('a', 'x', { cacheControl: 'a\nb' })).rejects.toThrow('cacheControl')
  })
})
