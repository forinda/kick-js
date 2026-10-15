import type { FileInfo, Storage } from './types'
import {
  checkLimit,
  collect,
  concatBytes,
  encodeKey,
  encodeSegment,
  isStream,
  toBytes,
} from './keys'

export interface S3StorageOptions {
  bucket: string
  /** AWS region, e.g. `'eu-west-1'`. Cloudflare R2 takes `'auto'`. Default `'us-east-1'`. */
  region?: string
  /**
   * A non-AWS endpoint — R2 (`https://<account>.r2.cloudflarestorage.com`),
   * MinIO (`http://localhost:9000`). Default AWS, `https://s3.<region>.amazonaws.com`.
   */
  endpoint?: string
  /**
   * Address objects as `<endpoint>/<bucket>/<key>` rather than
   * `<bucket>.<endpoint host>/<key>`. Default `true` with an `endpoint`
   * (MinIO and most self-hosted services need it), `false` for AWS.
   */
  forcePathStyle?: boolean
  accessKeyId: string
  secretAccessKey: string
  /** For temporary credentials (STS, an assumed role). */
  sessionToken?: string
  /** Default the global `fetch`. */
  fetch?: typeof fetch
  /**
   * Bytes per part when `put()` uploads a stream in parts. At least 5 MiB
   * (S3's minimum), the default. With S3's 10,000-part limit, the largest
   * stream is 10,000 × `partSize`: raise it for files over ~48 GiB.
   */
  partSize?: number
  /** Parts uploaded at once by `put()` with a stream. Default 4; memory use is about `partSize` × this. */
  partConcurrency?: number
}

// SHA-256 of nothing.
const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const MAX_EXPIRES = 7 * 24 * 60 * 60

// WebCrypto, not node:crypto, so the driver runs on edge runtimes too.
const utf8 = (text: string) => new TextEncoder().encode(text)
const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (data: Uint8Array | string) =>
  hex(
    await crypto.subtle.digest(
      'SHA-256',
      (typeof data === 'string' ? utf8(data) : data) as Uint8Array<ArrayBuffer>,
    ),
  )
async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, utf8(data)))
}

// The signing key changes once a day per region: derive it once.
let signingKey: { id: string; key: Promise<Uint8Array> } | undefined
function keyFor(secret: string, day: string, region: string) {
  const id = `${secret}\n${day}\n${region}`
  if (signingKey?.id !== id) {
    signingKey = {
      id,
      key: (async () => {
        let key = await hmac(utf8(`AWS4${secret}`), day)
        for (const part of [region, 's3', 'aws4_request']) key = await hmac(key, part)
        return key
      })(),
    }
  }
  return signingKey.key
}
/** `20130524T000000Z` */
const amzDate = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '')

interface Signing {
  region: string
  accessKeyId: string
  secretAccessKey: string
  date: Date
}

/**
 * AWS Signature Version 4 for S3: the signature over a canonical form of the
 * request, and the credential scope it was made for. `headers` are the
 * lowercase headers to sign besides `host`.
 */
export async function signV4(
  method: string,
  url: URL,
  headers: Record<string, string>,
  payloadHash: string,
  signing: Signing,
) {
  const stamp = amzDate(signing.date)
  const scope = `${stamp.slice(0, 8)}/${signing.region}/s3/aws4_request`
  const signed = Object.entries({ host: url.host, ...headers })
    .map(([name, value]) => [name, value.trim()] as const)
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
  const query = [...url.searchParams]
    .map(([k, v]) => [encodeSegment(k), encodeSegment(v)])
    .toSorted(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const signedHeaders = signed.map(([name]) => name).join(';')
  const canonical = [
    method,
    url.pathname,
    query,
    signed.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256(canonical)].join('\n')
  const key = await keyFor(signing.secretAccessKey, stamp.slice(0, 8), signing.region)
  return {
    signature: hex(await hmac(key, toSign)),
    credential: `${signing.accessKeyId}/${scope}`,
    signedHeaders,
  }
}

export interface UploadUrlOptions {
  /** Seconds the URL stays valid. Default 3600, at most 604800 (7 days). */
  expiresIn?: number
  /**
   * The exact size in bytes the upload must have. Signed into the URL, so the
   * bucket rejects any other size: check it against your limit first.
   */
  size?: number
  /** Signed into the URL: the browser must send this `Content-Type`, and the file is served with it. */
  contentType?: string
}

/** A part already in a multipart upload. */
export interface UploadedPart {
  partNumber: number
  etag: string
  size: number
}

/** A part as {@link Multipart.complete} takes it — what the browser got back from each part URL. */
export interface CompletedPart {
  partNumber: number
  etag: string
}

/**
 * S3 multipart uploads, for large files and uploads that survive a dropped
 * connection: the browser sends parts straight to the bucket through signed
 * URLs, retries only the parts that failed, and after a reload asks
 * `listParts()` which ones the bucket already has.
 */
export interface Multipart {
  /** Start an upload; returns its `uploadId`. */
  create(key: string, options?: { contentType?: string }): Promise<string>
  /** A signed URL to `PUT` part `partNumber` (1 to 10000) to. Every part but the last is at least 5 MiB. */
  partUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    options?: Omit<UploadUrlOptions, 'contentType'>,
  ): Promise<string>
  /** The parts the bucket has so far, in order. */
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>
  /** Join the parts into the file at `key`. */
  complete(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>
  /** Drop the upload and the parts sent so far. */
  abort(key: string, uploadId: string): Promise<void>
}

/** {@link Storage} plus uploads that go from the browser straight to the bucket. */
export interface S3Storage extends Storage {
  /** A signed URL the browser can `PUT` one file to, up to 5 GiB. */
  uploadUrl(key: string, options?: UploadUrlOptions): Promise<string>
  multipart: Multipart
}

// S3's minimum part size; `put()` streams in parts of this size.
const PART_SIZE = 5 * 1024 * 1024
const MAX_PARTS = 10_000
const BUCKET = Symbol('bucket')

const xmlEscape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const xmlUnescape = (value: string) =>
  value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_, dec, hex, name) =>
    dec
      ? String.fromCodePoint(Number(dec))
      : hex
        ? String.fromCodePoint(parseInt(hex, 16))
        : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name.toLowerCase() as 'amp']!,
  )
/** The text of each `<name>` element; S3's responses are flat enough for this. */
const tags = (xml: string, name: string) =>
  [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) =>
    xmlUnescape(m[1]),
  )
const tag = (xml: string, name: string) => tags(xml, name)[0]

function checkExpires(expiresIn = 3600) {
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_EXPIRES) {
    throw new Error(`s3Storage: expiresIn must be whole seconds from 1 to ${MAX_EXPIRES}`)
  }
  return expiresIn
}

function checkPartNumber(partNumber: number) {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
    throw new Error(`s3Storage: partNumber must be a whole number from 1 to ${MAX_PARTS}`)
  }
  return partNumber
}

/**
 * An S3-compatible bucket over `fetch`, signed with SigV4 — AWS S3,
 * Cloudflare R2, MinIO, and other S3 APIs. No AWS SDK.
 */
export function s3Storage(options: S3StorageOptions): S3Storage {
  for (const name of ['bucket', 'accessKeyId', 'secretAccessKey'] as const) {
    if (!options[name]) throw new Error(`s3Storage: \`${name}\` is required`)
  }
  const region = options.region ?? 'us-east-1'
  const endpoint = new URL(options.endpoint ?? `https://s3.${region}.amazonaws.com`)
  const origin = endpoint.origin + endpoint.pathname.replace(/\/+$/, '')
  const base =
    (options.forcePathStyle ?? options.endpoint !== undefined)
      ? `${origin}/${encodeSegment(options.bucket)}`
      : origin.replace('://', `://${options.bucket}.`)
  const fetchFn = options.fetch ?? globalThis.fetch
  const partSize = options.partSize ?? PART_SIZE
  const partConcurrency = options.partConcurrency ?? 4
  if (!Number.isInteger(partSize) || partSize < PART_SIZE) {
    throw new Error(`s3Storage: partSize must be a whole number of bytes, at least ${PART_SIZE}`)
  }
  if (!Number.isInteger(partConcurrency) || partConcurrency < 1) {
    throw new Error('s3Storage: partConcurrency must be a whole number, at least 1')
  }
  const signing = () => ({ ...options, region, date: new Date() })
  // The bucket itself (for listing) is BUCKET, never a key: every key goes
  // through encodeKey's check, so `''` can't address the bucket.
  const urlOf = (key: string | typeof BUCKET, query: Record<string, string> = {}) => {
    const url = new URL(key === BUCKET ? `${base}/` : `${base}/${encodeKey(key)}`)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    return url
  }

  interface Request {
    query?: Record<string, string>
    /** Sent unsigned, besides the signed ones. */
    headers?: Record<string, string>
    body?: Uint8Array
    contentType?: string
  }

  async function send(method: string, key: string | typeof BUCKET, request: Request = {}) {
    const url = urlOf(key, request.query)
    const payloadHash = request.body ? await sha256(request.body) : EMPTY_HASH
    const now = signing()
    const headers: Record<string, string> = {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate(now.date),
      ...(options.sessionToken ? { 'x-amz-security-token': options.sessionToken } : {}),
    }
    const { signature, credential, signedHeaders } = await signV4(
      method,
      url,
      headers,
      payloadHash,
      now,
    )
    return fetchFn(signedUrl(url), {
      method,
      headers: {
        ...headers,
        ...(request.contentType ? { 'content-type': request.contentType } : {}),
        ...request.headers,
        authorization: `AWS4-HMAC-SHA256 Credential=${credential}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: request.body,
    })
  }

  /** Send, and throw on anything but 2xx (and 404 when `missingOk`). */
  async function call(
    method: string,
    key: string | typeof BUCKET,
    request?: Request,
    missingOk = false,
  ) {
    const res = await send(method, key, request)
    if (res.ok || (missingOk && res.status === 404)) return res
    return fail(res, method, key)
  }

  async function fail(res: Response, method: string, key: string | typeof BUCKET): Promise<never> {
    const text = await res.text().catch(() => '')
    throw new Error(
      `s3Storage: ${method} '${String(key === BUCKET ? options.bucket : key)}' failed with ${res.status}: ${text.slice(0, 300)}`,
    )
  }

  const presignFor = (
    method: string,
    url: URL,
    expiresIn: number,
    headers: Record<string, string> = {},
  ) =>
    presign(
      url,
      checkExpires(expiresIn),
      { ...signing(), sessionToken: options.sessionToken },
      method,
      headers,
    )

  const multipart: Multipart = {
    async create(key, createOptions = {}) {
      const res = await call('POST', key, {
        query: { uploads: '' },
        contentType: createOptions.contentType,
      })
      const uploadId = tag(await res.text(), 'UploadId')
      // Some S3-compatible servers answer 200 with an unexpected body.
      if (!uploadId)
        throw new Error(`s3Storage: starting a multipart upload of '${key}' returned no UploadId`)
      return uploadId
    },
    async partUrl(key, uploadId, partNumber, partOptions = {}) {
      const url = urlOf(key, { partNumber: String(checkPartNumber(partNumber)), uploadId })
      return presignFor('PUT', url, partOptions.expiresIn ?? 3600, sizeHeader(partOptions.size))
    },
    async listParts(key, uploadId) {
      const parts: UploadedPart[] = []
      let marker: string | undefined
      do {
        const query: Record<string, string> = {
          uploadId,
          ...(marker ? { 'part-number-marker': marker } : {}),
        }
        const xml = await (await call('GET', key, { query })).text()
        for (const part of tags(xml, 'Part')) {
          parts.push({
            partNumber: Number(tag(part, 'PartNumber')),
            etag: tag(part, 'ETag'),
            size: Number(tag(part, 'Size')),
          })
        }
        marker = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextPartNumberMarker') : undefined
      } while (marker)
      return parts
    },
    async complete(key, uploadId, parts) {
      const body =
        '<CompleteMultipartUpload>' +
        parts
          .toSorted((a, b) => a.partNumber - b.partNumber)
          .map(
            (part) =>
              `<Part><PartNumber>${checkPartNumber(part.partNumber)}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`,
          )
          .join('') +
        '</CompleteMultipartUpload>'
      const res = await call('POST', key, { query: { uploadId }, body: toBytes(body) })
      // S3 can answer 200 and put the failure in the body.
      const xml = await res.text()
      if (xml.includes('<Error>')) {
        throw new Error(
          `s3Storage: completing '${key}' failed: ${tag(xml, 'Code')} ${tag(xml, 'Message') ?? ''}`,
        )
      }
    },
    async abort(key, uploadId) {
      await call('DELETE', key, { query: { uploadId } }, true)
    },
  }

  /**
   * A stream in parts of `partSize`, `partConcurrency` at a time: one PUT if
   * it fits in one part, a multipart upload if not, aborted on any failure.
   */
  async function putStream(key: string, body: AsyncIterable<Uint8Array>, contentType?: string) {
    let buffered: Uint8Array[] = []
    let size = 0
    let uploadId: Promise<string> | undefined
    let nextPart = 1
    let failed: { error: unknown } | undefined
    const parts: CompletedPart[] = []
    const inFlight = new Set<Promise<void>>()
    const send = () => {
      const bytes = concatBytes(buffered)
      const partNumber = checkPartNumber(nextPart++)
      buffered = []
      size = 0
      uploadId ??= multipart.create(key, { contentType })
      const upload = uploadId.then(async (id) => {
        const query = { partNumber: String(partNumber), uploadId: id }
        const res = await call('PUT', key, { query, body: bytes })
        parts.push({ partNumber, etag: res.headers.get('etag') ?? '' })
      })
      const tracked: Promise<void> = upload.then(
        () => void inFlight.delete(tracked),
        (error: unknown) => {
          inFlight.delete(tracked)
          failed ??= { error }
        },
      )
      inFlight.add(tracked)
    }
    try {
      for await (const chunk of body) {
        const bytes = typeof chunk === 'string' ? toBytes(chunk) : chunk
        buffered.push(bytes)
        size += bytes.length
        if (size >= partSize) {
          send()
          while (inFlight.size >= partConcurrency) await Promise.race(inFlight)
        }
        if (failed) throw failed.error
      }
      if (!uploadId) {
        await call('PUT', key, { body: concatBytes(buffered), contentType })
        return
      }
      if (size > 0) send()
      await Promise.all(inFlight)
      if (failed) throw failed.error
      await multipart.complete(key, await uploadId, parts)
    } catch (err) {
      await Promise.all(inFlight)
      if (uploadId) await uploadId.then((id) => multipart.abort(key, id)).catch(() => {})
      throw err
    }
  }

  const statOf = async (key: string): Promise<FileInfo | null> => {
    const res = await call('HEAD', key, {}, true)
    if (res.status === 404) return null
    return {
      key,
      size: Number(res.headers.get('content-length') ?? 0),
      lastModified: new Date(res.headers.get('last-modified') ?? 0),
      contentType: res.headers.get('content-type') ?? undefined,
    }
  }

  return {
    async put(key, body, putOptions = {}) {
      if (isStream(body)) return putStream(key, body, putOptions.contentType)
      await call('PUT', key, { body: toBytes(body), contentType: putOptions.contentType })
    },
    async putIfAbsent(key, body, putOptions = {}) {
      // S3 conditional writes: 412 when the key exists, 409 when another
      // conditional write to it is in progress — both mean someone else has it.
      const res = await send('PUT', key, {
        body: await collect(body),
        contentType: putOptions.contentType,
        headers: { 'if-none-match': '*' },
      })
      if (res.status === 412 || res.status === 409) {
        await res.body?.cancel()
        return false
      }
      if (!res.ok) await fail(res, 'PUT', key)
      await res.body?.cancel()
      return true
    },
    async get(key) {
      const res = await call('GET', key, {}, true)
      return res.status === 404 ? null : new Uint8Array(await res.arrayBuffer())
    },
    async getStream(key) {
      const res = await call('GET', key, {}, true)
      if (res.status === 404) {
        await res.body?.cancel()
        return null
      }
      return res.body ?? new Blob([]).stream()
    },
    stat: statOf,
    async exists(key) {
      return (await statOf(key)) !== null
    },
    async delete(key) {
      await call('DELETE', key, {}, true)
    },
    async list(listOptions = {}) {
      const query: Record<string, string> = {
        'list-type': '2',
        'max-keys': String(checkLimit(listOptions.limit)),
        ...(listOptions.prefix ? { prefix: listOptions.prefix } : {}),
        ...(listOptions.cursor ? { 'continuation-token': listOptions.cursor } : {}),
      }
      const xml = await (await call('GET', BUCKET, { query })).text()
      const files = tags(xml, 'Contents').map((entry) => ({
        key: tag(entry, 'Key'),
        size: Number(tag(entry, 'Size')),
        lastModified: new Date(tag(entry, 'LastModified')),
      }))
      const cursor =
        tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : undefined
      return cursor ? { files, cursor } : { files }
    },
    async url(key, urlOptions = {}) {
      return presignFor('GET', urlOf(key), urlOptions.expiresIn ?? 3600)
    },
    async uploadUrl(key, uploadOptions = {}) {
      return presignFor('PUT', urlOf(key), uploadOptions.expiresIn ?? 3600, {
        ...sizeHeader(uploadOptions.size),
        ...(uploadOptions.contentType ? { 'content-type': uploadOptions.contentType } : {}),
      })
    },
    multipart,
  }
}

function sizeHeader(size: number | undefined): Record<string, string> {
  if (size === undefined) return {}
  if (!Number.isInteger(size) || size < 0) {
    throw new Error('s3Storage: size must be a whole number of bytes')
  }
  return { 'content-length': String(size) }
}

/** The URL as it was signed — URLSearchParams would encode spaces as `+`. */
function signedUrl(url: URL): string {
  const query = [...url.searchParams].map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`)
  return `${url.origin}${url.pathname}${query.length > 0 ? `?${query.join('&')}` : ''}`
}

/**
 * A query-string signed URL for `method`, valid for `expiresIn` seconds.
 * `headers` (lowercase) are signed too, and the request must send them as given.
 */
export async function presign(
  url: URL,
  expiresIn: number,
  signing: Signing & { sessionToken?: string },
  method = 'GET',
  headers: Record<string, string> = {},
): Promise<string> {
  const scope = `${amzDate(signing.date).slice(0, 8)}/${signing.region}/s3/aws4_request`
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  url.searchParams.set('X-Amz-Credential', `${signing.accessKeyId}/${scope}`)
  url.searchParams.set('X-Amz-Date', amzDate(signing.date))
  url.searchParams.set('X-Amz-Expires', String(expiresIn))
  if (signing.sessionToken) url.searchParams.set('X-Amz-Security-Token', signing.sessionToken)
  url.searchParams.set(
    'X-Amz-SignedHeaders',
    ['host', ...Object.keys(headers)].toSorted().join(';'),
  )
  const { signature } = await signV4(method, url, headers, 'UNSIGNED-PAYLOAD', signing)
  return `${signedUrl(url)}&X-Amz-Signature=${signature}`
}
