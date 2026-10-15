import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
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
        [500, 'boom'],
        [204, ''],
      )
      const big = new Uint8Array(5 * 1024 * 1024)
      await expect(files.put('k', Readable.from([big]))).rejects.toThrow('500')
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
        // Later parts finish first, so completion order differs from part order.
        const n = Number(url.searchParams.get('partNumber'))
        await new Promise((done) => setTimeout(done, 60 - n * 5))
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
      const { files, calls } = scripted(
        [200, '', { 'content-length': String(6 * GiB) }],
        [200, '', { 'content-length': '7' }],
        [200, '<R><UploadId>u</UploadId></R>'],
        [200, '<CopyPartResult><ETag>"1"</ETag></CopyPartResult>'],
        [200, '<CopyPartResult><ETag>"2"</ETag></CopyPartResult>'],
        [200, '<CopyPartResult><ETag>"3"</ETag></CopyPartResult>'],
        [200, '<CompleteMultipartUploadResult/>'],
      )
      await files.compose('dest', ['big', 'tail'])
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
