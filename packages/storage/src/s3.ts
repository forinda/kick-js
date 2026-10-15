import { createHash, createHmac } from 'node:crypto'
import type { Storage } from './index'
import { encodeKey, encodeSegment, toBytes } from './keys'

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
}

const EMPTY_HASH = createHash('sha256').digest('hex')
const MAX_EXPIRES = 7 * 24 * 60 * 60

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')
const hmac = (key: Uint8Array | string, data: string) =>
  createHmac('sha256', key).update(data).digest()
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
export function signV4(
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
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n')
  let key: Uint8Array = hmac(`AWS4${signing.secretAccessKey}`, stamp.slice(0, 8))
  for (const part of [signing.region, 's3', 'aws4_request']) key = hmac(key, part)
  return {
    signature: createHmac('sha256', key).update(toSign).digest('hex'),
    credential: `${signing.accessKeyId}/${scope}`,
    signedHeaders,
  }
}

/**
 * An S3-compatible bucket over `fetch`, signed with SigV4 — AWS S3,
 * Cloudflare R2, MinIO, and other S3 APIs. No AWS SDK.
 */
export function s3Storage(options: S3StorageOptions): Storage {
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
  const signing = () => ({ ...options, region, date: new Date() })

  async function send(method: string, key: string, body?: Uint8Array, contentType?: string) {
    const url = new URL(`${base}/${encodeKey(key)}`)
    const payloadHash = body ? sha256(body) : EMPTY_HASH
    const now = signing()
    const headers: Record<string, string> = {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate(now.date),
      ...(options.sessionToken ? { 'x-amz-security-token': options.sessionToken } : {}),
    }
    const { signature, credential, signedHeaders } = signV4(method, url, headers, payloadHash, now)
    return fetchFn(url, {
      method,
      headers: {
        ...headers,
        ...(contentType ? { 'content-type': contentType } : {}),
        authorization: `AWS4-HMAC-SHA256 Credential=${credential}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body,
    })
  }

  async function fail(res: Response, method: string, key: string): Promise<never> {
    const text = await res.text().catch(() => '')
    throw new Error(
      `s3Storage: ${method} '${key}' failed with ${res.status}: ${text.slice(0, 300)}`,
    )
  }

  return {
    async put(key, body, putOptions = {}) {
      const res = await send('PUT', key, toBytes(body), putOptions.contentType)
      if (!res.ok) await fail(res, 'PUT', key)
    },
    async get(key) {
      const res = await send('GET', key)
      if (res.status === 404) return null
      if (!res.ok) await fail(res, 'GET', key)
      return new Uint8Array(await res.arrayBuffer())
    },
    async exists(key) {
      const res = await send('HEAD', key)
      if (res.status === 404) return false
      if (!res.ok) await fail(res, 'HEAD', key)
      return true
    },
    async delete(key) {
      const res = await send('DELETE', key)
      if (!res.ok && res.status !== 404) await fail(res, 'DELETE', key)
    },
    async url(key, urlOptions = {}) {
      const expiresIn = urlOptions.expiresIn ?? 3600
      if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_EXPIRES) {
        throw new Error(`s3Storage: expiresIn must be whole seconds from 1 to ${MAX_EXPIRES}`)
      }
      return presign(new URL(`${base}/${encodeKey(key)}`), expiresIn, {
        ...signing(),
        sessionToken: options.sessionToken,
      })
    },
  }
}

/** A query-string signed GET URL, valid for `expiresIn` seconds. */
export function presign(
  url: URL,
  expiresIn: number,
  signing: Signing & { sessionToken?: string },
): string {
  const scope = `${amzDate(signing.date).slice(0, 8)}/${signing.region}/s3/aws4_request`
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  url.searchParams.set('X-Amz-Credential', `${signing.accessKeyId}/${scope}`)
  url.searchParams.set('X-Amz-Date', amzDate(signing.date))
  url.searchParams.set('X-Amz-Expires', String(expiresIn))
  if (signing.sessionToken) url.searchParams.set('X-Amz-Security-Token', signing.sessionToken)
  url.searchParams.set('X-Amz-SignedHeaders', 'host')
  const { signature } = signV4('GET', url, {}, 'UNSIGNED-PAYLOAD', signing)
  // The query as it was signed — URLSearchParams would encode spaces as `+`.
  const query = [...url.searchParams].map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`)
  return `${url.origin}${url.pathname}?${query.join('&')}&X-Amz-Signature=${signature}`
}
