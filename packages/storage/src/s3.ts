import type { FileInfo, PutOptions, Storage } from './types'
import {
  checkDelimiter,
  checkKey,
  checkLimit,
  checkRange,
  concatBytes,
  encodeKey,
  encodeSegment,
  isStream,
  toBytes,
  type Body,
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
  /** Fixed keys. Set both, or pass {@link S3StorageOptions.credentials} instead. */
  accessKeyId?: string
  secretAccessKey?: string
  /** For temporary credentials (STS, an assumed role). */
  sessionToken?: string
  /**
   * Keys fetched as needed instead of fixed ones — an IAM role on ECS, EC2 or
   * EKS. Called before every request and signed URL, so it should cache and
   * refresh before expiry itself — as `fromNodeProviderChain()` from
   * `@aws-sdk/credential-providers` does.
   */
  credentials?: () => S3Credentials | Promise<S3Credentials>
  /**
   * Milliseconds to wait for the bucket to start answering each request;
   * past it the request is aborted and the call rejects. Covers the wait for
   * the response, not reading a body already arriving. Default: no limit.
   */
  timeoutMs?: number
  /**
   * Tries per request, the first included: a request that fails to connect,
   * times out, or gets 500, 502, 503 or 504 (S3's `SlowDown` is a 503) is
   * sent again after a random wait that doubles each time (up to 20 s), as
   * the AWS SDK does. A create-only write (`putIfAbsent`) is retried only on
   * 503, which S3 sends before doing anything: after another failure the
   * write may have happened, and a retry would find it taken. Default 3; 1
   * turns retries off.
   */
  maxAttempts?: number
  /** Default the global `fetch`. */
  fetch?: typeof fetch
  /**
   * Bytes per part when `put()` uploads a stream in parts. At least 5 MiB
   * (S3's minimum), the default. With S3's 10,000-part limit, the largest
   * stream is 10,000 × `partSize`: raise it for files over ~48 GiB.
   */
  partSize?: number
  /**
   * Encrypt what this storage writes, at rest in the bucket: `{ type: 'AES256' }`
   * with keys S3 manages, or `{ type: 'aws:kms', keyId? }` with a KMS key (the
   * account's default S3 key when `keyId` is left out). Applies to `put`,
   * `putIfAbsent`, `compose`, `multipart.create` and `uploadForm`; not to
   * `uploadUrl`, whose browser request would have to send the headers itself.
   * AWS S3 supports both; MinIO needs KMS configured, and some S3-compatible
   * services support neither.
   */
  serverSideEncryption?: { type: 'AES256' } | { type: 'aws:kms'; keyId?: string }
  /**
   * The canned ACL every file this storage writes gets, e.g. `'public-read'`
   * for files served straight from the bucket or its CDN. Without it the
   * bucket's default ACL applies, which is private on AWS, DigitalOcean Spaces
   * and MinIO (a bucket policy can still make files readable). Applies to
   * `put`, `putIfAbsent`, `compose`, `multipart.create`, `uploadForm` and
   * `uploadUrl` (signed into the URL's query, as the AWS SDK's presigner does).
   * AWS buckets with Object Ownership set to "bucket owner enforced" (the
   * default for new buckets) refuse every ACL but `bucket-owner-full-control`,
   * and Block Public Access (also on by default) refuses public ones: see the
   * guide's "Public files".
   */
  acl?: S3Acl
  /**
   * The storage class every file this storage writes gets, e.g.
   * `'STANDARD_IA'` for files read rarely. Unset, the bucket's default
   * (`STANDARD` on AWS). A write's own `storageClass` wins.
   */
  storageClass?: S3StorageClass
  /**
   * Where public files are served from, for {@link S3Storage.publicUrl}: a CDN
   * or custom domain, e.g. `https://cdn.example.com` or
   * `https://files.example.com/avatars`. Default the bucket's own address.
   */
  publicUrl?: string
  /** Parts uploaded at once by `put()` with a stream. Default 4; memory use is about `partSize` × this. */
  partConcurrency?: number
}

/**
 * S3's storage classes. Other S3 APIs have their own (R2: `STANDARD`,
 * `STANDARD_IA`), so any UPPER_SNAKE name is accepted. A file in `GLACIER`
 * or `DEEP_ARCHIVE` has to be restored before it can be read.
 */
export type S3StorageClass =
  | 'STANDARD'
  | 'STANDARD_IA'
  | 'ONEZONE_IA'
  | 'INTELLIGENT_TIERING'
  | 'GLACIER_IR'
  | 'GLACIER'
  | 'DEEP_ARCHIVE'
  | 'REDUCED_REDUNDANCY'
  | 'EXPRESS_ONEZONE'
  | (string & {})

/** S3's canned ACLs. */
export type S3Acl =
  | 'private'
  | 'public-read'
  | 'public-read-write'
  | 'authenticated-read'
  | 'aws-exec-read'
  | 'bucket-owner-read'
  | 'bucket-owner-full-control'

const ACLS: readonly string[] = [
  'private',
  'public-read',
  'public-read-write',
  'authenticated-read',
  'aws-exec-read',
  'bucket-owner-read',
  'bucket-owner-full-control',
] satisfies S3Acl[]

/** True for one of S3's canned ACLs. */
export const isS3Acl = (value: unknown): value is S3Acl =>
  typeof value === 'string' && ACLS.includes(value)

export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
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

/**
 * How a bucket stores and serves one file — sent with each write that
 * creates it. All optional; unset leaves the bucket's default.
 */
export interface S3ObjectOptions {
  /** This file's canned ACL, instead of the storage's `acl`. */
  acl?: S3Acl
  /** `Cache-Control` the file is served with, e.g. `public, max-age=31536000, immutable`. */
  cacheControl?: string
  /** `Content-Disposition` the file is served with, e.g. `attachment; filename="report.pdf"`. */
  contentDisposition?: string
  /** `Content-Encoding` the file is served with, e.g. `gzip` for bytes already gzipped. */
  contentEncoding?: string
  /** `Content-Language` the file is served with, e.g. `en`. */
  contentLanguage?: string
  /**
   * Your own name/value pairs kept with the file (`x-amz-meta-*`), returned by
   * `stat()`. Names are letters, digits, `-`, `_` and `.`; S3 stores them
   * lowercase. Values are printable ASCII. At most 2 KB in all.
   */
  metadata?: Record<string, string>
  /** This file's storage class, instead of the storage's `storageClass`. */
  storageClass?: S3StorageClass
}

/**
 * `acl` and `metadata` are signed into the URL; `cacheControl`,
 * `contentDisposition`, `contentEncoding` and `contentLanguage` are signed
 * as headers, so the browser's `PUT` must send them as given, like `contentType`.
 */
export interface UploadUrlOptions extends S3ObjectOptions {
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

/** {@link PutOptions} plus what only a bucket keeps. */
export interface S3PutOptions extends PutOptions, S3ObjectOptions {}

/** {@link FileInfo} plus what a bucket returns about a file. */
export interface S3FileInfo extends FileInfo {
  /** What was set with `metadata`, names lowercase. */
  metadata: Record<string, string>
  cacheControl?: string
  contentDisposition?: string
  contentEncoding?: string
  contentLanguage?: string
  /** Absent for `STANDARD`, which S3 doesn't report. */
  storageClass?: string
}

/** The `S3ObjectOptions` go into the form's fields and its policy. */
export interface UploadFormOptions extends S3ObjectOptions {
  /** Seconds the form stays valid. Default 3600, at most 604800 (7 days). */
  expiresIn?: number
  /** Largest file accepted, in bytes. The bucket refuses anything bigger. */
  maxSize: number
  /** Smallest file accepted, in bytes. Default 0. */
  minSize?: number
  /**
   * The exact `Content-Type` the file must be sent with, and is served with.
   * Exact only: a family (`image/`) would also admit `image/svg+xml`, which
   * can carry script. Check the client's declared type against your
   * allowlist, then sign that one.
   */
  contentType?: string
}

/** What a browser form POSTs to: the URL, and fields to send before the file. */
export interface UploadForm {
  url: string
  fields: Record<string, string>
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
  create(key: string, options?: S3PutOptions): Promise<string>
  /** A signed URL to `PUT` part `partNumber` (1 to 10000) to. Every part but the last is at least 5 MiB. */
  partUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    options?: Pick<UploadUrlOptions, 'expiresIn' | 'size'>,
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
  put(key: string, body: Body, options?: S3PutOptions): Promise<void>
  putIfAbsent(key: string, body: Body, options?: S3PutOptions): Promise<boolean>
  stat(key: string): Promise<S3FileInfo | null>
  /** A signed URL the browser can `PUT` one file to, up to 5 GiB. */
  uploadUrl(key: string, options?: UploadUrlOptions): Promise<string>
  /**
   * A signed form (POST policy) the browser uploads one file through, with a
   * size range the bucket enforces — for when the size isn't known up front.
   * AWS S3 and MinIO support it; Cloudflare R2 doesn't (use `uploadUrl`).
   */
  uploadForm(key: string, options: UploadFormOptions): Promise<UploadForm>
  multipart: Multipart
  /**
   * Join objects already in this bucket, in order, into `key` — copied by
   * the bucket itself (CopyObject, UploadPartCopy), not through this server.
   * S3 needs every part but the last to be at least 5 MiB; sources under
   * that (other than the last) are streamed through instead.
   */
  compose(key: string, sources: readonly string[], options?: S3PutOptions): Promise<void>
  /**
   * Create the bucket if it doesn't exist: `true` when this call created it.
   * For a fresh MinIO in development or tests; a production bucket is
   * provisioned with its policies, not at boot.
   */
  ensureBucket(): Promise<boolean>
  /**
   * Delete many files, up to 1000 per request (S3's DeleteObjects) instead of
   * one request each. Keys that don't exist count as deleted, as with
   * `delete()`. Throws listing the keys the bucket refused.
   */
  deleteMany(keys: readonly string[]): Promise<void>
  /** The bucket's address, e.g. `https://avatars.s3.eu-west-1.amazonaws.com`: equal for two storages on one bucket. */
  readonly location: string
  /**
   * The unsigned address of a public file (`acl: 'public-read'`, or a bucket
   * policy that allows reading it): `publicUrl` if set, else the bucket's
   * address, plus the encoded key. Nothing is checked: for a private file
   * the address answers 403. Use `url()` for those.
   */
  publicUrl(key: string): string
}

// S3's minimum part size; `put()` streams in parts of this size.
const PART_SIZE = 5 * 1024 * 1024
const MAX_PARTS = 10_000
// S3's largest single copy (CopyObject) and part copy.
const MAX_COPY = 5 * 1024 ** 3
const BUCKET = Symbol('bucket')

// \t, \n and \r as references too: written raw, an XML parser turns `\r\n` into
// `\n`, and the bucket would read another key than the one sent.
const xmlEscape = (value: string) => value.replace(/[&<>"'\t\n\r]/g, (c) => `&#${c.charCodeAt(0)};`)
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
  if (!options.bucket) throw new Error('s3Storage: `bucket` is required')
  if (options.credentials) {
    if (options.accessKeyId || options.secretAccessKey) {
      throw new Error('s3Storage: pass `credentials` or fixed keys, not both')
    }
  } else {
    for (const name of ['accessKeyId', 'secretAccessKey'] as const) {
      if (!options[name]) throw new Error(`s3Storage: \`${name}\` is required (or \`credentials\`)`)
    }
  }
  const { timeoutMs } = options
  const maxAttempts = options.maxAttempts ?? 3
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('s3Storage: maxAttempts must be a whole number, at least 1')
  }
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1)) {
    throw new Error('s3Storage: timeoutMs must be a whole number of milliseconds, at least 1')
  }
  const region = options.region ?? 'us-east-1'
  const endpoint = new URL(options.endpoint ?? `https://s3.${region}.amazonaws.com`)
  const origin = endpoint.origin + endpoint.pathname.replace(/\/+$/, '')
  const base =
    (options.forcePathStyle ?? options.endpoint !== undefined)
      ? `${origin}/${encodeSegment(options.bucket)}`
      : origin.replace('://', `://${options.bucket}.`)
  const fetchFn = options.fetch ?? globalThis.fetch
  if (options.publicUrl !== undefined && !URL.canParse(options.publicUrl)) {
    throw new Error(`s3Storage: publicUrl must be a URL, not '${options.publicUrl}'`)
  }
  const publicBase = (options.publicUrl ?? base).replace(/\/+$/, '')
  objectHeaders({ storageClass: options.storageClass }) // checked once, up front
  const partSize = options.partSize ?? PART_SIZE
  if (options.acl !== undefined && !isS3Acl(options.acl)) {
    throw new Error(
      `s3Storage: acl must be one of ${ACLS.join(', ')}, not '${String(options.acl)}'`,
    )
  }
  const acl = options.acl
  const sse = encryptionHeaders(options.serverSideEncryption)
  /** The ACL a write gets: its own, else the storage's. */
  const aclFor = (own: S3Acl | undefined): S3Acl | undefined => {
    if (own !== undefined && !isS3Acl(own)) {
      throw new Error(`s3Storage: acl must be one of ${ACLS.join(', ')}, not '${String(own)}'`)
    }
    return own ?? acl
  }
  /** A write's options, with the storage's defaults where it has none. */
  const withDefaults = (own: S3ObjectOptions): S3ObjectOptions => ({
    ...own,
    storageClass: own.storageClass ?? options.storageClass,
  })
  /** Sent, signed, on every request that creates an object: encryption, then the file's own. */
  const writeHeaders = (own: S3ObjectOptions = {}): Record<string, string> => {
    const chosen = aclFor(own.acl)
    return {
      ...sse,
      ...(chosen ? { 'x-amz-acl': chosen } : {}),
      ...objectHeaders(withDefaults(own)),
    }
  }
  const partConcurrency = options.partConcurrency ?? 4
  if (!Number.isInteger(partSize) || partSize < PART_SIZE) {
    throw new Error(`s3Storage: partSize must be a whole number of bytes, at least ${PART_SIZE}`)
  }
  if (!Number.isInteger(partConcurrency) || partConcurrency < 1) {
    throw new Error('s3Storage: partConcurrency must be a whole number, at least 1')
  }
  /** The keys to sign with now, the region and the time. */
  /**
   * The bucket's clock minus ours, learned from a clock-skew error and added
   * to every signature's time after it, signed URLs included — as the AWS SDK
   * does — so a host whose clock drifted past S3's 15 minutes keeps working.
   */
  let clockOffset = 0
  const signing = async () => {
    const keys = options.credentials
      ? await options.credentials()
      : {
          accessKeyId: options.accessKeyId!,
          secretAccessKey: options.secretAccessKey!,
          sessionToken: options.sessionToken,
        }
    return { ...keys, region, date: new Date(Date.now() + clockOffset) }
  }
  // The bucket itself (for listing) is BUCKET, never a key: every key goes
  // through encodeKey's check, so `''` can't address the bucket.
  const urlOf = (key: string | typeof BUCKET, query: Record<string, string> = {}) => {
    const url = new URL(key === BUCKET ? `${base}/` : `${base}/${encodeKey(key)}`)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    return url
  }

  interface Request {
    query?: Record<string, string>
    /** Headers to send, signed. */
    amz?: Record<string, string>
    /** Sent unsigned, besides the signed ones. */
    headers?: Record<string, string>
    body?: Uint8Array
    contentType?: string
    /**
     * CopyObject, UploadPartCopy, CompleteMultipartUpload: S3 can answer 200
     * and put the failure in the body, or send no body when it aborted.
     */
    errorIn200?: boolean
  }

  /** {@link sendOnce}, again on a failure worth retrying — see `maxAttempts`. */
  async function send(method: string, key: string | typeof BUCKET, request: Request = {}) {
    const createOnly = request.headers?.['if-none-match'] !== undefined
    for (let attempt = 1; ; attempt++) {
      const last = attempt >= maxAttempts
      let classified: { res: Response; retry: boolean }
      try {
        classified = await classify(
          method,
          await sendOnce(method, key, request),
          request,
          createOnly,
        )
      } catch (err) {
        // No answer at all: a create-only write may have landed anyway.
        if (last || createOnly) throw err
        await backoff(attempt)
        continue
      }
      if (last || !classified.retry) return classified.res
      await classified.res.body?.cancel()
      await backoff(attempt)
    }
  }

  /**
   * Whether `res` is worth sending again, as the AWS SDK decides: 5xx but 501,
   * 429, S3's 400 `RequestTimeout`, a clock-skew error (after learning the
   * offset), and a 200 that carries a failure (see `errorIn200`), taken as a
   * 503. A create-only write is sent again only when S3 refused it before
   * writing: 503, 429, `RequestTimeout`, clock skew. A body read here is put
   * back into the response returned.
   */
  async function classify(
    method: string,
    res: Response,
    request: Request,
    createOnly: boolean,
  ): Promise<{ res: Response; retry: boolean }> {
    const again = (text: string, status: number) =>
      new Response(status === 204 || method === 'HEAD' ? null : text, {
        status,
        statusText: res.statusText,
        headers: res.headers,
      })
    if (res.ok && request.errorIn200) {
      const text = await res.text()
      const failed =
        text.trim() === '' ||
        (/<\/Error>\s*$/.test(text) && tag(text, 'Code') !== 'PreconditionFailed')
      // Not for create-only: the write may have happened before S3 failed.
      return failed && !createOnly
        ? { res: again(text, 503), retry: true }
        : { res: again(text, res.status), retry: false }
    }
    if (res.status === 503 || res.status === 429) return { res, retry: true }
    if (res.status >= 500 && res.status <= 504 && res.status !== 501) {
      return { res, retry: !createOnly }
    }
    if ((res.status === 400 || res.status === 403) && method !== 'HEAD') {
      const text = await res.text()
      const code = tag(text, 'Code')
      const serverTime = Date.parse(res.headers.get('date') ?? '')
      if (CLOCK_SKEW.has(code) && !Number.isNaN(serverTime)) {
        clockOffset = serverTime - Date.now()
        return { res: again(text, res.status), retry: true }
      }
      return { res: again(text, res.status), retry: code === 'RequestTimeout' }
    }
    return { res, retry: false }
  }

  async function sendOnce(method: string, key: string | typeof BUCKET, request: Request) {
    const url = urlOf(key, request.query)
    const payloadHash = request.body ? await sha256(request.body) : EMPTY_HASH
    const now = await signing()
    const headers: Record<string, string> = {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate(now.date),
      ...(now.sessionToken ? { 'x-amz-security-token': now.sessionToken } : {}),
      ...request.amz,
    }
    const { signature, credential, signedHeaders } = await signV4(
      method,
      url,
      headers,
      payloadHash,
      now,
    )
    // Aborts only the wait for the response: a body already arriving is left to its reader.
    const controller = timeoutMs ? new AbortController() : undefined
    const timer =
      controller &&
      setTimeout(() => {
        const name = String(key === BUCKET ? options.bucket : key)
        controller.abort(
          new Error(`s3Storage: ${method} '${name}' got no answer within ${timeoutMs} ms`),
        )
      }, timeoutMs)
    try {
      return await fetchFn(signedUrl(url), {
        method,
        headers: {
          ...headers,
          ...(request.contentType ? { 'content-type': request.contentType } : {}),
          ...request.headers,
          authorization: `AWS4-HMAC-SHA256 Credential=${credential}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
        body: request.body,
        signal: controller?.signal,
      })
    } finally {
      clearTimeout(timer)
    }
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

  /** `body`: the response text when it was already read. */
  async function fail(
    res: Response,
    method: string,
    key: string | typeof BUCKET,
    body?: string,
  ): Promise<never> {
    const text = body ?? (await res.text().catch(() => ''))
    throw new Error(
      `s3Storage: ${method} '${String(key === BUCKET ? options.bucket : key)}' failed with ${res.status}: ${text.slice(0, 300)}`,
    )
  }

  const presignFor = async (
    method: string,
    url: URL,
    expiresIn: number,
    headers: Record<string, string> = {},
  ) => presign(url, checkExpires(expiresIn), await signing(), method, headers)

  /**
   * Join an upload's parts. With `createOnly`, only if nothing is at `key`
   * yet (`If-None-Match: *`): `false` when something is.
   */
  async function completeUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
    createOnly = false,
  ): Promise<boolean> {
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
    const res = await send('POST', key, {
      query: { uploadId },
      body: toBytes(body),
      ...(createOnly ? { headers: { 'if-none-match': '*' } } : {}),
      errorIn200: true,
    })
    if (createOnly && (res.status === 412 || res.status === 409)) {
      await res.body?.cancel()
      return false
    }
    if (!res.ok) await fail(res, 'POST', key)
    // S3 can answer 200 and put the failure in the body.
    const xml = await res.text()
    if (xml.includes('<Error>')) {
      if (createOnly && tag(xml, 'Code') === 'PreconditionFailed') return false
      throw new Error(
        `s3Storage: completing '${key}' failed: ${tag(xml, 'Code')} ${tag(xml, 'Message') ?? ''}`,
      )
    }
    return true
  }

  /** One PUT; with `createOnly`, `false` when the key exists (412) or is being created (409). */
  async function putOnce(
    key: string,
    bytes: Uint8Array,
    putOptions: S3PutOptions,
    createOnly = false,
  ) {
    const res = await send('PUT', key, {
      body: bytes,
      amz: writeHeaders(putOptions),
      contentType: putOptions.contentType,
      ...(createOnly ? { headers: { 'if-none-match': '*' } } : {}),
    })
    if (createOnly && (res.status === 412 || res.status === 409)) {
      await res.body?.cancel()
      return false
    }
    if (!res.ok) await fail(res, 'PUT', key)
    await res.body?.cancel()
    return true
  }

  const multipart: Multipart = {
    async create(key, createOptions = {}) {
      const res = await call('POST', key, {
        query: { uploads: '' },
        amz: writeHeaders(createOptions),
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
      await completeUpload(key, uploadId, parts)
    },
    async abort(key, uploadId) {
      await call('DELETE', key, { query: { uploadId } }, true)
    },
  }

  /**
   * A stream in parts of `partSize`, `partConcurrency` at a time: one PUT if
   * it fits in one part, a multipart upload if not, aborted on any failure.
   */
  async function putStream(
    key: string,
    body: AsyncIterable<Uint8Array>,
    putOptions: S3PutOptions,
    createOnly = false,
  ): Promise<boolean> {
    let buffered: Uint8Array[] = []
    let size = 0
    let uploadId: Promise<string> | undefined
    let nextPart = 1
    let failed: { error: unknown } | undefined
    const parts: CompletedPart[] = []
    const inFlight = new Set<Promise<void>>()
    const sendPart = () => {
      const bytes = concatBytes(buffered)
      const partNumber = checkPartNumber(nextPart++)
      buffered = []
      size = 0
      uploadId ??= multipart.create(key, putOptions)
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
          // Not the atomic check (completing is), but it saves uploading a
          // big body only to find the key taken.
          if (createOnly && !uploadId && (await statOf(key))) return false
          sendPart()
          while (inFlight.size >= partConcurrency) await Promise.race(inFlight)
        }
        if (failed) throw failed.error
      }
      if (!uploadId) return await putOnce(key, concatBytes(buffered), putOptions, createOnly)
      if (size > 0) sendPart()
      await Promise.all(inFlight)
      if (failed) throw failed.error
      const id = await uploadId
      if (await completeUpload(key, id, parts, createOnly)) return true
      await multipart.abort(key, id)
      return false
    } catch (err) {
      await Promise.all(inFlight)
      if (uploadId) await uploadId.then((id) => multipart.abort(key, id)).catch(() => {})
      throw err
    }
  }

  /** `x-amz-copy-source` for an object in this bucket. */
  const copySource = (source: string) => `/${encodeSegment(options.bucket)}/${encodeKey(source)}`

  async function compose(key: string, sources: readonly string[], putOptions: S3PutOptions = {}) {
    if (sources.length === 0) throw new Error('s3Storage: compose() needs at least one source')
    const sizes = await Promise.all(
      sources.map(async (source) => {
        const info = await statOf(source)
        if (!info) throw new Error(`s3Storage: compose() source '${source}' does not exist`)
        return info.size
      }),
    )
    const streamed = async () => {
      async function* joined() {
        for (const source of sources) {
          const stream = await storage.getStream(source)
          if (!stream) throw new Error(`s3Storage: compose() source '${source}' disappeared`)
          yield* stream as unknown as AsyncIterable<Uint8Array>
        }
      }
      await storage.put(key, joined(), putOptions)
    }
    // A part under 5 MiB is only allowed last: such sources can't be copied as parts.
    if (sizes.slice(0, -1).some((size) => size < PART_SIZE)) return streamed()

    if (sources.length === 1 && sizes[0] <= MAX_COPY) {
      const res = await call('PUT', key, {
        amz: {
          'x-amz-copy-source': copySource(sources[0]),
          'x-amz-metadata-directive': 'REPLACE',
          ...writeHeaders(putOptions),
        },
        contentType: putOptions.contentType ?? 'application/octet-stream',
        errorIn200: true,
      })
      const xml = await res.text()
      if (xml.includes('<Error>'))
        throw new Error(`s3Storage: copying into '${key}' failed: ${tag(xml, 'Code')}`)
      return
    }

    // Each source in ranges of at most 5 GiB, split evenly so no range is small.
    const ranges = sources.flatMap((source, i) => {
      const pieces = Math.max(1, Math.ceil(sizes[i] / MAX_COPY))
      const each = Math.ceil(sizes[i] / pieces)
      return Array.from({ length: pieces }, (_, p) => ({
        source,
        from: p * each,
        to: Math.min(sizes[i], (p + 1) * each) - 1,
      })).filter((range) => range.to >= range.from)
    })
    if (ranges.length > MAX_PARTS) return streamed()
    const uploadId = await multipart.create(key, putOptions)
    try {
      const parts: CompletedPart[] = []
      // ponytail: partConcurrency copies at a time, like put()'s parts.
      for (let i = 0; i < ranges.length; i += partConcurrency) {
        const batch = ranges.slice(i, i + partConcurrency)
        await Promise.all(
          batch.map(async ({ source, from, to }, j) => {
            const partNumber = i + j + 1
            const res = await call('PUT', key, {
              query: { partNumber: String(partNumber), uploadId },
              amz: {
                'x-amz-copy-source': copySource(source),
                'x-amz-copy-source-range': `bytes=${from}-${to}`,
              },
              errorIn200: true,
            })
            const xml = await res.text()
            const etag = tag(xml, 'ETag')
            if (!etag)
              throw new Error(
                `s3Storage: copying part ${partNumber} into '${key}' failed: ${xml.slice(0, 200)}`,
              )
            parts.push({ partNumber, etag })
          }),
        )
      }
      await completeUpload(key, uploadId, parts)
    } catch (err) {
      await multipart.abort(key, uploadId).catch(() => {})
      throw err
    }
  }

  async function uploadForm(key: string, formOptions: UploadFormOptions): Promise<UploadForm> {
    checkKey(key)
    const { maxSize, minSize = 0, contentType } = formOptions
    if (
      !Number.isInteger(maxSize) ||
      !Number.isInteger(minSize) ||
      minSize < 0 ||
      maxSize < minSize
    ) {
      throw new Error('s3Storage: uploadForm needs whole-number sizes, 0 <= minSize <= maxSize')
    }
    const expiresIn = checkExpires(formOptions.expiresIn ?? 3600)
    const keys = await signing()
    const date = keys.date
    const stamp = amzDate(date)
    const credential = `${keys.accessKeyId}/${stamp.slice(0, 8)}/${region}/s3/aws4_request`
    const fields: Record<string, string> = {
      key,
      'x-amz-algorithm': 'AWS4-HMAC-SHA256',
      'x-amz-credential': credential,
      'x-amz-date': stamp,
      ...(keys.sessionToken ? { 'x-amz-security-token': keys.sessionToken } : {}),
      // A POST form names some fields differently from the headers.
      ...Object.fromEntries(
        Object.entries(writeHeaders(formOptions)).map(([name, value]) => [
          FORM_FIELDS[name] ?? name,
          value,
        ]),
      ),
    }
    if (contentType !== undefined) {
      if (!/^[\w.+-]+\/[\w.+-]+$/.test(contentType)) {
        throw new Error(
          `s3Storage: uploadForm contentType must be one exact type like 'image/png', not '${contentType}'`,
        )
      }
      fields['Content-Type'] = contentType
    }
    const policy = {
      expiration: new Date(date.getTime() + expiresIn * 1000).toISOString(),
      conditions: [
        { bucket: options.bucket },
        ...Object.entries(fields).map(([name, value]) => ({ [name]: value })),
        ['content-length-range', minSize, maxSize],
      ],
    }
    // Base64 without Buffer, for edge runtimes.
    const encoded = btoa(String.fromCharCode(...utf8(JSON.stringify(policy))))
    const signingKey = await keyFor(keys.secretAccessKey, stamp.slice(0, 8), region)
    return {
      url: `${base}/`,
      fields: {
        ...fields,
        policy: encoded,
        'x-amz-signature': hex(await hmac(signingKey, encoded)),
      },
    }
  }

  const statOf = async (key: string): Promise<S3FileInfo | null> => {
    const res = await call('HEAD', key, {}, true)
    if (res.status === 404) return null
    const metadata: Record<string, string> = {}
    for (const [name, value] of res.headers) {
      if (name.startsWith('x-amz-meta-')) metadata[name.slice('x-amz-meta-'.length)] = value
    }
    const header = (name: string) => res.headers.get(name) ?? undefined
    return {
      key,
      size: Number(res.headers.get('content-length') ?? 0),
      lastModified: new Date(res.headers.get('last-modified') ?? 0),
      contentType: header('content-type'),
      metadata,
      ...(header('cache-control') ? { cacheControl: header('cache-control') } : {}),
      ...(header('content-disposition')
        ? { contentDisposition: header('content-disposition') }
        : {}),
      ...(header('content-encoding') ? { contentEncoding: header('content-encoding') } : {}),
      ...(header('content-language') ? { contentLanguage: header('content-language') } : {}),
      ...(header('x-amz-storage-class') ? { storageClass: header('x-amz-storage-class') } : {}),
    }
  }

  const storage: S3Storage = {
    location: base,
    publicUrl: (key) => `${publicBase}/${encodeKey(key)}`,
    compose,
    uploadForm,
    async put(key, body, putOptions = {}) {
      if (isStream(body)) {
        await putStream(key, body, putOptions)
        return
      }
      await call('PUT', key, {
        body: toBytes(body),
        amz: writeHeaders(putOptions),
        contentType: putOptions.contentType,
      })
    },
    async putIfAbsent(key, body, putOptions = {}) {
      // S3 conditional writes: 412 when the key exists, 409 when another
      // conditional write to it is in progress — both mean someone else has it.
      // A stream larger than a part goes up in parts, conditional on completing.
      if (isStream(body)) return putStream(key, body, putOptions, true)
      return putOnce(key, toBytes(body), putOptions, true)
    },
    async get(key) {
      const res = await call('GET', key, {}, true)
      return res.status === 404 ? null : new Uint8Array(await res.arrayBuffer())
    },
    async getStream(key, range) {
      const r = checkRange(range)
      const res = await send(
        'GET',
        key,
        r ? { headers: { range: `bytes=${r.start}-${r.end ?? ''}` } } : {},
      )
      // 416: the range starts past the end — nothing to read, as on disk.
      if (res.status === 404 || res.status === 416) {
        await res.body?.cancel()
        return res.status === 404 ? null : new Blob([]).stream()
      }
      if (r && res.status === 200) {
        // A server that ignored the Range header sent the whole file.
        await res.body?.cancel()
        throw new Error(`s3Storage: GET '${key}' returned the whole file for a byte range`)
      }
      if (!res.ok) return fail(res, 'GET', key)
      return res.body ?? new Blob([]).stream()
    },
    stat: statOf,
    async exists(key) {
      return (await statOf(key)) !== null
    },
    async delete(key) {
      await call('DELETE', key, {}, true)
    },
    async deleteMany(keys) {
      for (const key of keys) {
        checkKey(key)
        // XML 1.0 can't carry these at all, not even as references.
        const unsendable = [...key].some((c) => c < ' ' && c !== '\t' && c !== '\n' && c !== '\r')
        if (unsendable) {
          throw new Error(
            `s3Storage: deleteMany can't send key '${key}': it has a control character`,
          )
        }
      }
      const unique = [...new Set(keys)]
      const refused: string[] = []
      for (let i = 0; i < unique.length; i += 1000) {
        const body = toBytes(
          '<Delete><Quiet>true</Quiet>' +
            unique
              .slice(i, i + 1000)
              .map((key) => `<Object><Key>${xmlEscape(key)}</Key></Object>`)
              .join('') +
            '</Delete>',
        )
        // S3 needs a checksum of the body here; WebCrypto has SHA-256, not MD5.
        const digest = await sha256(body)
        const checksum = btoa(
          String.fromCharCode(...(digest.match(/../g) ?? []).map((h) => parseInt(h, 16))),
        )
        const res = await call('POST', BUCKET, {
          query: { delete: '' },
          body,
          amz: { 'x-amz-checksum-sha256': checksum },
          contentType: 'application/xml',
        })
        // Quiet mode lists only failures, as <Error> entries.
        for (const error of tags(await res.text(), 'Error')) {
          refused.push(`${tag(error, 'Key')} (${tag(error, 'Code')})`)
        }
      }
      if (refused.length > 0) {
        throw new Error(`s3Storage: deleteMany could not delete ${refused.join(', ')}`)
      }
    },
    async list(listOptions = {}) {
      const delimiter = checkDelimiter(listOptions.delimiter)
      const query: Record<string, string> = {
        'list-type': '2',
        'max-keys': String(checkLimit(listOptions.limit)),
        ...(listOptions.prefix ? { prefix: listOptions.prefix } : {}),
        ...(listOptions.cursor ? { 'continuation-token': listOptions.cursor } : {}),
        ...(delimiter ? { delimiter } : {}),
      }
      const xml = await (await call('GET', BUCKET, { query })).text()
      const files = tags(xml, 'Contents').map((entry) => ({
        key: tag(entry, 'Key'),
        size: Number(tag(entry, 'Size')),
        lastModified: new Date(tag(entry, 'LastModified')),
      }))
      // Each <CommonPrefixes> holds one <Prefix>; the request's own <Prefix> is outside them.
      const prefixes = tags(xml, 'CommonPrefixes').map((entry) => tag(entry, 'Prefix'))
      const cursor =
        tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : undefined
      return {
        files,
        ...(delimiter ? { prefixes } : {}),
        ...(cursor ? { cursor } : {}),
      }
    },
    async url(key, urlOptions = {}) {
      // S3's response-* parameters: the bucket sends these headers with the file.
      const query: Record<string, string> = {}
      if (urlOptions.contentType) query['response-content-type'] = urlOptions.contentType
      if (urlOptions.contentDisposition)
        query['response-content-disposition'] = urlOptions.contentDisposition
      if (urlOptions.cacheControl) query['response-cache-control'] = urlOptions.cacheControl
      return presignFor('GET', urlOf(key, query), urlOptions.expiresIn ?? 3600)
    },
    async uploadUrl(key, uploadOptions = {}) {
      // `x-amz-*` go in the query, signed without the browser having to send
      // them; other headers can't, so the browser sends those as signed.
      const chosen = aclFor(uploadOptions.acl)
      const query: Record<string, string> = chosen ? { 'x-amz-acl': chosen } : {}
      const headers: Record<string, string> = {}
      for (const [name, value] of Object.entries(objectHeaders(withDefaults(uploadOptions)))) {
        if (name.startsWith('x-amz-')) query[name] = value
        else headers[name] = value
      }
      return presignFor('PUT', urlOf(key, query), uploadOptions.expiresIn ?? 3600, {
        ...sizeHeader(uploadOptions.size),
        ...(uploadOptions.contentType ? { 'content-type': uploadOptions.contentType } : {}),
        ...headers,
      })
    },
    multipart,
    async ensureBucket() {
      const head = await send('HEAD', BUCKET)
      if (head.ok) return false
      if (head.status !== 404) return fail(head, 'HEAD', BUCKET)
      // us-east-1 is the default and must not be named; R2's 'auto' isn't a location.
      const body =
        region === 'us-east-1' || region === 'auto'
          ? undefined
          : new TextEncoder().encode(
              `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${region}</LocationConstraint></CreateBucketConfiguration>`,
            )
      const created = await send('PUT', BUCKET, { body })
      if (created.ok) return true
      // Another process created it between the two calls.
      const text = created.status === 409 ? await created.text() : undefined
      if (text?.includes('BucketAlreadyOwnedByYou')) return false
      return fail(created, 'PUT', BUCKET, text)
    },
  }
  return storage
}

/** Full jitter: a random wait up to 100 ms × 2^(attempt − 1), at most 20 s. */
const backoff = (attempt: number) =>
  new Promise((done) =>
    setTimeout(done, Math.random() * Math.min(20_000, 100 * 2 ** (attempt - 1))),
  )

/** S3's answers to a request signed too far from its own time. */
const CLOCK_SKEW = new Set(['RequestTimeTooSkewed', 'RequestExpired', 'RequestInTheFuture'])

/** A POST form's field for a header, where the two differ. */
const FORM_FIELDS: Record<string, string> = {
  'x-amz-acl': 'acl',
  'cache-control': 'Cache-Control',
  'content-disposition': 'Content-Disposition',
  'content-encoding': 'Content-Encoding',
  'content-language': 'Content-Language',
}

/** The headers a file's {@link S3ObjectOptions} (but `acl`) are sent as, checked. */
function objectHeaders(own: S3ObjectOptions): Record<string, string> {
  const out: Record<string, string> = {}
  const plain: Array<[keyof S3ObjectOptions, string]> = [
    ['cacheControl', 'cache-control'],
    ['contentDisposition', 'content-disposition'],
    ['contentEncoding', 'content-encoding'],
    ['contentLanguage', 'content-language'],
  ]
  for (const [option, header] of plain) {
    const value = own[option]
    if (value === undefined) continue
    if (typeof value !== 'string' || !/^[\x20-\x7e]*$/.test(value)) {
      throw new Error(`s3Storage: ${option} must be printable ASCII`)
    }
    out[header] = value
  }
  if (own.storageClass !== undefined) {
    if (typeof own.storageClass !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(own.storageClass)) {
      throw new Error(
        `s3Storage: storageClass must be an S3 storage class like 'STANDARD_IA', not '${String(own.storageClass)}'`,
      )
    }
    out['x-amz-storage-class'] = own.storageClass
  }
  let bytes = 0
  for (const [name, value] of Object.entries(own.metadata ?? {})) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error(`s3Storage: metadata name '${name}' must be letters, digits, '-', '_' or '.'`)
    }
    if (typeof value !== 'string' || !/^[\x20-\x7e]*$/.test(value)) {
      throw new Error(`s3Storage: metadata '${name}' must be printable ASCII`)
    }
    bytes += name.length + value.length
    out[`x-amz-meta-${name.toLowerCase()}`] = value
  }
  if (bytes > 2048) throw new Error("s3Storage: metadata is over S3's 2 KB limit")
  return out
}

/** The headers S3 reads `serverSideEncryption` from, checked once up front. */
function encryptionHeaders(
  encryption: S3StorageOptions['serverSideEncryption'],
): Record<string, string> {
  if (!encryption) return {}
  if (encryption.type === 'AES256') {
    if ('keyId' in encryption) throw new Error("s3Storage: keyId is only for type 'aws:kms'")
    return { 'x-amz-server-side-encryption': 'AES256' }
  }
  if (encryption.type !== 'aws:kms') {
    throw new Error(
      `s3Storage: serverSideEncryption.type must be 'AES256' or 'aws:kms', not '${String((encryption as { type: unknown }).type)}'`,
    )
  }
  const { keyId } = encryption
  if (keyId !== undefined && (typeof keyId !== 'string' || !keyId.trim())) {
    throw new Error('s3Storage: serverSideEncryption.keyId must be a non-empty string')
  }
  return {
    'x-amz-server-side-encryption': 'aws:kms',
    ...(keyId ? { 'x-amz-server-side-encryption-aws-kms-key-id': keyId } : {}),
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
