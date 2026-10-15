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
  it("matches AWS's signed GET with a Range header", () => {
    const url = new URL('https://examplebucket.s3.amazonaws.com/test.txt')
    const headers = {
      range: 'bytes=0-9',
      'x-amz-content-sha256': EMPTY,
      'x-amz-date': '20130524T000000Z',
    }
    expect(signV4('GET', url, headers, EMPTY, aws)).toEqual({
      signature: 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
      credential: 'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request',
      signedHeaders: 'host;range;x-amz-content-sha256;x-amz-date',
    })
  })

  it("matches AWS's presigned URL", () => {
    const url = presign(new URL('https://examplebucket.s3.amazonaws.com/test.txt'), 86400, aws)
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

  it('requires its credentials', () => {
    expect(() => s3Storage({ ...options, secretAccessKey: '' })).toThrow('secretAccessKey')
  })
})
