/**
 * Resumable uploads through your own server, over the tus protocol
 * (https://tus.io) — for clients like `tus-js-client` and Uppy's `@uppy/tus`.
 * An upload is kept, as it arrives, in a {@link Storage} of its own (a local
 * folder by default, or a bucket every instance shares); a dropped connection
 * keeps what was received, and the client resumes from there. Once complete,
 * the file moves into any `Storage` — disk, memory or a bucket:
 *
 * ```ts
 * import { TusAdapter } from '@forinda/kickjs-storage/tus'
 *
 * bootstrap({
 *   modules,
 *   adapters: [TusAdapter({ path: '/api/uploads', storage: FILES, maxSize: 2 * 1024 ** 3 })],
 * })
 * ```
 *
 * tus 1.0.0 with the creation, creation-with-upload, termination,
 * expiration, checksum and concatenation extensions.
 *
 * @module @forinda/kickjs-storage/tus
 */
import { createHash, randomUUID, type Hash } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { defineAdapter, type InjectionToken } from '@forinda/kickjs'
import { diskStorage } from './disk'
import { checkKey } from './keys'
import type { Storage } from './types'

const VERSION = '1.0.0'
const EXTENSIONS = 'creation,creation-with-upload,termination,expiration,checksum,concatenation'
const CHECKSUMS = ['sha1', 'sha256', 'md5']
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** An upload in progress, or just completed. */
export interface TusUpload {
  id: string
  /** Where the file goes in the storage once complete. */
  key: string
  /** Total size in bytes, from `Upload-Length` (or the parts' sizes added up, for a final upload). */
  size: number
  /** Bytes received so far. */
  offset: number
  /** `Upload-Metadata`, decoded — `filename`, `filetype`, whatever the client sends. */
  metadata: Record<string, string>
  /** What `onCreate` returned as `data`, e.g. the owner's id, for `authorize`. */
  data?: unknown
  /** When an unfinished upload is dropped. Moves forward with every PATCH. */
  expiresAt: Date
  /**
   * Concatenation: `'partial'` for one of several uploads sent in parallel,
   * `'final'` for the upload that joins them. Absent for an ordinary upload.
   */
  concat?: 'partial' | 'final'
}

/** What the client asked to create. */
export interface TusCreateRequest {
  headers: IncomingHttpHeaders
  size: number
  metadata: Record<string, string>
  /** `'partial'` or `'final'` when the client uploads in parallel (concatenation). */
  concat?: 'partial' | 'final'
}

export interface TusOptions {
  /** The upload endpoint, e.g. `'/api/uploads'`. Uploads live at `<path>/<id>`. */
  path: string
  /** Where completed files go: a `Storage`, or a DI token bound to one. */
  storage: Storage | InjectionToken<Storage>
  /**
   * Where unfinished uploads are kept, under `tus/`: a `Storage`, or a DI
   * token bound to one. Default a `diskStorage` at `dir`. With several
   * instances, give them a shared one — a bucket — and any instance can take
   * any request of any upload.
   */
  partials?: Storage | InjectionToken<Storage>
  /** The folder for the default `partials`, relative to `process.cwd()`. Default `'.tus'`. */
  dir?: string
  /** Largest upload accepted, in bytes. Default 1 GiB. */
  maxSize?: number
  /** Seconds an unfinished upload is kept after its last PATCH. Default 86400 (a day). */
  expiresIn?: number
  /**
   * Accept or refuse a new upload, and choose its key — the place to check
   * who is uploading (`headers.authorization`) and what (`metadata.filetype`,
   * `size`). Throw an `HttpException` to refuse with its status. `data` is
   * kept with the upload and handed to `authorize`. Default key: `uploads/<id>`.
   */
  onCreate?(
    request: TusCreateRequest,
    id: string,
  ): { key?: string; data?: unknown } | void | Promise<{ key?: string; data?: unknown } | void>
  /**
   * Check every later request (HEAD, PATCH, DELETE) to an upload, and each
   * part a final upload joins — e.g. that the caller is the user who created
   * it, from `upload.data`. Throw an `HttpException` to refuse. Without it,
   * anyone holding the upload URL (an unguessable id) can continue or cancel it.
   */
  authorize?(headers: IncomingHttpHeaders, upload: TusUpload): void | Promise<void>
  /**
   * Runs once the file is in the storage — record it in your database. If it
   * throws, the client gets a 500 and its retry runs it again, so it runs at
   * least once: make it idempotent (an upsert keyed by `upload.id`). Not run
   * for the parts of a parallel upload, only for the final one.
   */
  onComplete?(upload: TusUpload): void | Promise<void>
}

interface Info {
  id: string
  key: string
  size: number
  metadata: Record<string, string>
  /** The raw `Upload-Metadata`, returned as-is on HEAD. */
  rawMetadata?: string
  data?: unknown
  expiresAt: string
  concat?: 'partial' | 'final'
  /** For a final upload: the ids of its parts, in order. */
  parts?: string[]
}

/** Where a range of the upload is: the chunk object, and its size. */
interface Commit {
  chunk: string
  size: number
}

class TusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** `filename ZmlsZS50eHQ=,private` → `{ filename: 'file.txt', private: '' }` */
function parseMetadata(header: string | undefined): Record<string, string> {
  // No prototype: a client-chosen key like `__proto__` is just a key.
  const metadata: Record<string, string> = Object.create(null)
  if (!header) return metadata
  for (const pair of header.split(',')) {
    const [key, value, extra] = pair.trim().split(' ')
    if (
      !key ||
      extra !== undefined ||
      (value !== undefined && !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    ) {
      throw new TusError(400, 'Invalid Upload-Metadata')
    }
    metadata[key] = value === undefined ? '' : Buffer.from(value, 'base64').toString('utf8')
  }
  return metadata
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** A non-negative integer header, or undefined when absent. */
function intHeader(req: IncomingMessage, name: string): number | undefined {
  const value = header(req, name)
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) throw new TusError(400, `Invalid ${name}`)
  return Number(value)
}

/** `Upload-Checksum: sha1 <base64>` → a hash to feed and the digest to expect. */
function checksumOf(req: IncomingMessage): { hash: Hash; expected: string } | undefined {
  const value = header(req, 'upload-checksum')
  if (value === undefined) return undefined
  const [algorithm, expected, extra] = value.trim().split(' ')
  if (!CHECKSUMS.includes(algorithm) || !expected || extra !== undefined) {
    throw new TusError(
      400,
      `Upload-Checksum must be one of ${CHECKSUMS.join(', ')} and a base64 digest`,
    )
  }
  return { hash: createHash(algorithm), expected }
}

const isStorage = (value: unknown): value is Storage =>
  typeof (value as Storage | undefined)?.put === 'function'

/**
 * The tus endpoint as a Node `(req, res, next)` handler. Requests outside
 * `path` go to `next`. {@link TusAdapter} mounts it on every runtime; use this
 * directly to put it in front of another server.
 */
export function createTusHandler(
  options: Omit<TusOptions, 'storage' | 'partials'> & { storage: Storage; partials?: Storage },
) {
  const base = options.path.replace(/\/+$/, '')
  const partials = options.partials ?? diskStorage({ root: options.dir ?? '.tus' })
  const maxSize = options.maxSize ?? 1024 ** 3
  const expiresIn = (options.expiresIn ?? 86_400) * 1000
  // Same-instance requests to one upload wait their turn here (423). Across
  // instances, the commit markers below keep the upload consistent.
  const locked = new Set<string>()
  /** Commit markers never change once written, so each is read once. */
  const commits = new Map<string, Map<number, Commit>>()

  const infoKey = (id: string) => `tus/${id}/info`
  const doneKey = (id: string) => `tus/${id}/done`
  const commitKey = (id: string, offset: number) => `tus/${id}/at/${offset}`
  const decode = <T>(bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as T

  async function loadInfo(id: string): Promise<Info | null> {
    const bytes = await partials.get(infoKey(id))
    return bytes ? decode<Info>(bytes) : null
  }
  const saveInfo = (info: Info) => partials.put(infoKey(info.id), JSON.stringify(info))
  const isDone = (id: string) => partials.exists(doneKey(id))

  /** Every key an upload has in `partials`. */
  async function keysOf(id: string) {
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const page = await partials.list({ prefix: `tus/${id}/`, cursor })
      keys.push(...page.files.map((f) => f.key))
      cursor = page.cursor
    } while (cursor)
    return keys
  }

  async function drop(id: string) {
    commits.delete(id)
    for (const key of await keysOf(id)) await partials.delete(key)
  }

  /**
   * The upload's committed chunks, in order, and the offset they reach:
   * from 0, each commit marker says which chunk covers that offset and how
   * far it goes; the first gap is the offset.
   */
  async function committed(id: string): Promise<{ offset: number; chunks: Commit[] }> {
    let known = commits.get(id)
    if (!known) commits.set(id, (known = new Map()))
    const chunks: Commit[] = []
    let offset = 0
    let listed: Set<number> | undefined
    for (;;) {
      let commit = known.get(offset)
      if (!commit) {
        // One listing tells which offsets have markers; read only those not seen.
        const prefix = `tus/${id}/at/`
        listed ??= new Set(
          (await keysOf(id))
            .filter((key) => key.startsWith(prefix))
            .map((key) => Number(key.slice(prefix.length))),
        )
        if (!listed.has(offset)) break
        const bytes = await partials.get(commitKey(id, offset))
        if (!bytes) break
        commit = decode<Commit>(bytes)
        known.set(offset, commit)
      }
      chunks.push(commit)
      offset += commit.size
    }
    return { offset, chunks }
  }

  const toUpload = (info: Info, offset: number): TusUpload => ({
    id: info.id,
    key: info.key,
    size: info.size,
    offset,
    metadata: info.metadata,
    data: info.data,
    expiresAt: new Date(info.expiresAt),
    ...(info.concat ? { concat: info.concat } : {}),
  })

  async function load(id: string) {
    const info = await loadInfo(id)
    if (!info) return null
    const done = await isDone(id)
    if (!done && new Date(info.expiresAt) < new Date()) {
      if (!locked.has(id)) await drop(id)
      return null
    }
    const offset = done ? info.size : (await committed(id)).offset
    return { info, upload: toUpload(info, offset), done }
  }

  /**
   * Write the request body as a chunk at `offset`, then commit it. A client
   * that disconnects keeps what arrived: the chunk is committed with the
   * bytes received (unless a checksum was promised and can't be checked).
   * Resolves with the new offset.
   */
  async function receive(req: IncomingMessage, id: string, offset: number, room: number) {
    const checksum = checksumOf(req)
    let received = 0
    let cut = false
    async function* body() {
      try {
        for await (const chunk of req as AsyncIterable<Buffer>) {
          received += chunk.length
          if (received > room) {
            throw new TusError(413, 'Body is larger than the rest of the upload')
          }
          checksum?.hash.update(chunk)
          yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length)
        }
      } catch (err) {
        if (err instanceof TusError) throw err
        cut = true // the client went away mid-body
      }
    }
    const chunk = `tus/${id}/chunk/${offset}-${randomUUID()}`
    try {
      await partials.put(chunk, body())
    } catch (err) {
      await partials.delete(chunk).catch(() => {})
      throw err
    }
    const discard = async (error?: TusError) => {
      await partials.delete(chunk)
      if (error) throw error
      return offset
    }
    if (received === 0) return discard()
    if (checksum) {
      if (cut) return discard()
      if (checksum.hash.digest('base64') !== checksum.expected) {
        return discard(new TusError(460, 'Checksum mismatch'))
      }
    }
    const commit: Commit = { chunk, size: received }
    // Of two requests writing the same offset — two instances, a retry —
    // the first to commit wins; the other's bytes are dropped.
    if (!(await partials.putIfAbsent(commitKey(id, offset), JSON.stringify(commit)))) {
      return discard(
        new TusError(409, 'Another request wrote this offset first; ask HEAD for the offset'),
      )
    }
    commits.get(id)?.set(offset, commit)
    return offset + received
  }

  /** The file, read from its chunks in order — of this upload, or of each part of a final one. */
  async function* contents(info: Info): AsyncGenerator<Uint8Array> {
    for (const id of info.parts ?? [info.id]) {
      for (const { chunk } of (await committed(id)).chunks) {
        const stream = await partials.getStream(chunk)
        if (!stream) throw new Error(`tus: chunk '${chunk}' of upload ${id} is missing`)
        yield* stream as unknown as AsyncIterable<Uint8Array>
      }
    }
  }

  /**
   * Move a complete upload into the storage, run `onComplete`, then mark it
   * done. A failure anywhere leaves it not done: the client's retry (a PATCH
   * at the final offset) runs all of it again — so `onComplete` runs at least
   * once, and more than once if it, or marking done, fails after it ran.
   * The parts of a parallel upload are only marked done; the final upload
   * moves them.
   */
  async function finish(info: Info) {
    if (info.concat !== 'partial') {
      // ponytail: the bytes pass through this server once more; a bucket-side copy
      // (UploadPartCopy) would skip that when partials and storage share a bucket.
      await options.storage.put(info.key, contents(info), {
        contentType: info.metadata.filetype || info.metadata.contentType || undefined,
      })
      await options.onComplete?.(toUpload(info, info.size))
    }
    await partials.putIfAbsent(doneKey(info.id), '')
    if (info.concat === 'partial') return
    // Keep this upload's info and done marker (until expiry) so HEAD still
    // answers; drop its bytes, and the parts of a final upload entirely.
    for (const key of await keysOf(info.id)) {
      if (key.includes('/chunk/') || key.includes('/at/')) await partials.delete(key)
    }
    commits.delete(info.id)
    for (const part of info.parts ?? []) await drop(part)
  }

  const touch = (info: Info): Info => ({
    ...info,
    expiresAt: new Date(Date.now() + expiresIn).toISOString(),
  })

  /** `final;/uploads/a https://host/uploads/b` → the upload ids. */
  function partIds(value: string): string[] {
    const urls = value.slice('final;'.length).trim().split(/\s+/).filter(Boolean)
    if (urls.length === 0) throw new TusError(400, 'Upload-Concat final lists no uploads')
    return urls.map((url) => {
      const path = new URL(url, 'http://localhost').pathname
      const id = path.slice(base.length + 1)
      if (!path.startsWith(`${base}/`) || !UPLOAD_ID.test(id)) {
        throw new TusError(400, `Upload-Concat names an upload this endpoint doesn't have: ${url}`)
      }
      return id
    })
  }

  type Send = (status: number, headers?: Record<string, string>, body?: string) => void

  async function create(req: IncomingMessage, send: Send) {
    const concatHeader = header(req, 'upload-concat')
    const concat: 'partial' | 'final' | undefined =
      concatHeader === 'partial'
        ? 'partial'
        : concatHeader?.startsWith('final;')
          ? 'final'
          : undefined
    if (concatHeader !== undefined && !concat) throw new TusError(400, 'Invalid Upload-Concat')
    const rawMetadata = header(req, 'upload-metadata')
    const metadata = parseMetadata(rawMetadata)
    const id = randomUUID()

    let size = 0
    let parts: string[] | undefined
    if (concat === 'final') {
      parts = partIds(concatHeader!)
      for (const partId of parts) {
        const part = await load(partId)
        if (!part || part.info.concat !== 'partial') {
          throw new TusError(400, `Upload ${partId} is not a partial upload`)
        }
        await options.authorize?.(req.headers, part.upload)
        if (!part.done) throw new TusError(400, `Upload ${partId} is not complete`)
        size += part.info.size
      }
    } else {
      const length = intHeader(req, 'upload-length')
      if (length === undefined) throw new TusError(400, 'Upload-Length is required')
      size = length
    }
    if (size > maxSize) throw new TusError(413, `Upload is larger than ${maxSize} bytes`)

    const request = { headers: req.headers, size, metadata, ...(concat ? { concat } : {}) }
    const chosen = (await options.onCreate?.(request, id)) ?? {}
    const info: Info = touch({
      id,
      key: checkKey(chosen.key ?? `uploads/${id}`),
      size,
      metadata,
      rawMetadata,
      data: chosen.data,
      expiresAt: '',
      ...(concat ? { concat } : {}),
      ...(parts ? { parts } : {}),
    })
    await saveInfo(info)
    const headers: Record<string, string> = {
      Location: `${base}/${id}`,
      'Upload-Expires': new Date(info.expiresAt).toUTCString(),
    }

    if (concat === 'final') {
      await finish(info)
    } else if (header(req, 'content-type') === 'application/offset+octet-stream') {
      // creation-with-upload: the first bytes ride along with the POST.
      locked.add(id)
      try {
        const offset = await receive(req, id, 0, size)
        if (offset === size) await finish(info)
        headers['Upload-Offset'] = String(offset)
      } finally {
        locked.delete(id)
      }
    } else if (size === 0) {
      await finish(info)
    }
    return send(201, headers)
  }

  async function handle(req: IncomingMessage, res: ServerResponse, id: string | undefined) {
    const send: Send = (status, headers = {}, body) => {
      res.writeHead(status, {
        'Tus-Resumable': VERSION,
        ...headers,
        ...(body ? { 'Content-Type': 'text/plain; charset=utf-8' } : {}),
      })
      res.end(body)
    }
    // The override is for clients that can only send POST. Honouring it on GET
    // would let a request csrf() lets through (a safe method) act as a PATCH or DELETE.
    const actual = (req.method ?? 'GET').toUpperCase()
    const method =
      actual === 'POST' ? (header(req, 'x-http-method-override') ?? actual).toUpperCase() : actual

    if (method === 'OPTIONS') {
      return send(204, {
        'Tus-Version': VERSION,
        'Tus-Extension': EXTENSIONS,
        'Tus-Max-Size': String(maxSize),
        'Tus-Checksum-Algorithm': CHECKSUMS.join(','),
      })
    }
    if (header(req, 'tus-resumable') !== VERSION) {
      return send(412, { 'Tus-Version': VERSION }, 'Unsupported Tus-Resumable version')
    }

    if (id === undefined) {
      if (method !== 'POST') return send(405, { Allow: 'OPTIONS, POST' })
      return create(req, send)
    }

    const concatHeaders = (info: Info): Record<string, string> =>
      info.concat === 'final'
        ? { 'Upload-Concat': `final;${info.parts!.map((p) => `${base}/${p}`).join(' ')}` }
        : info.concat === 'partial'
          ? { 'Upload-Concat': 'partial' }
          : {}

    if (method === 'HEAD') {
      const found = await load(id)
      if (!found) return send(404, {}, 'Upload not found')
      const { info, upload, done } = found
      await options.authorize?.(req.headers, upload)
      return send(200, {
        'Upload-Offset': String(upload.offset),
        'Upload-Length': String(upload.size),
        ...(info.rawMetadata ? { 'Upload-Metadata': info.rawMetadata } : {}),
        ...concatHeaders(info),
        'Cache-Control': 'no-store',
        ...(done ? {} : { 'Upload-Expires': upload.expiresAt.toUTCString() }),
      })
    }
    if (method !== 'PATCH' && method !== 'DELETE') {
      return send(405, { Allow: 'OPTIONS, HEAD, PATCH, DELETE' })
    }

    // Locked before anything is read, so the offset checked below is still the
    // offset when the body is appended — two PATCHes can't both pass the check.
    if (locked.has(id)) throw new TusError(423, 'Upload is being written')
    locked.add(id)
    try {
      const found = await load(id)
      if (!found) return send(404, {}, 'Upload not found')
      const { info, upload, done } = found
      await options.authorize?.(req.headers, upload)

      if (method === 'DELETE') {
        await drop(id)
        return send(204)
      }
      if (info.concat === 'final') throw new TusError(403, 'A final upload takes no PATCH')
      if (header(req, 'content-type') !== 'application/offset+octet-stream') {
        throw new TusError(415, 'Content-Type must be application/offset+octet-stream')
      }
      const offset = intHeader(req, 'upload-offset')
      if (offset !== upload.offset) {
        throw new TusError(409, `Upload-Offset must be ${upload.offset}`)
      }
      if (done) return send(204, { 'Upload-Offset': String(upload.size) })
      const next = touch(info)
      await saveInfo(next)
      const reached = await receive(req, id, offset, upload.size - offset)
      if (reached === upload.size) await finish(next)
      return send(204, {
        'Upload-Offset': String(reached),
        'Upload-Expires': new Date(next.expiresAt).toUTCString(),
      })
    } finally {
      locked.delete(id)
    }
  }

  const pathOf = (req: IncomingMessage & { originalUrl?: string }) =>
    new URL(req.originalUrl ?? req.url ?? '/', 'http://localhost').pathname
  const owns = (req: IncomingMessage) => {
    const pathname = pathOf(req)
    return pathname === base || pathname.startsWith(`${base}/`)
  }

  const handler = async (
    req: IncomingMessage & { originalUrl?: string },
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => {
    const pathname = pathOf(req)
    let id: string | undefined
    if (pathname === base || pathname === `${base}/`) id = undefined
    else if (pathname.startsWith(`${base}/`)) {
      id = pathname.slice(base.length + 1)
      // Ids are UUIDs: anything else is not an upload, and never a key in partials.
      if (!UPLOAD_ID.test(id)) {
        res.writeHead(404, { 'Tus-Resumable': VERSION }).end()
        return
      }
    } else return next()

    try {
      await handle(req, res, id)
    } catch (err) {
      const status = (err as { status?: number }).status
      const known = typeof status === 'number' && status >= 400 && status < 600
      // The client went away: nothing to answer.
      // (Not req.destroyed: Node sets it once a body has been read to the end.)
      if (!known && (res.destroyed || req.socket?.destroyed)) return
      if (!known) return next(err)
      if (!res.headersSent) {
        res.writeHead(status, {
          'Tus-Resumable': VERSION,
          'Content-Type': 'text/plain; charset=utf-8',
        })
      }
      res.end((err as Error).message)
      // A refused body still arriving: drop it rather than read it.
      if (!req.complete) req.destroy()
    }
  }

  /** Drop expired uploads: unfinished ones past their expiry, and finished ones' records. */
  async function sweep() {
    // ponytail: lists every partials key; fine for thousands of uploads in flight.
    const ids = new Set<string>()
    let cursor: string | undefined
    do {
      const page = await partials.list({ prefix: 'tus/', cursor })
      for (const file of page.files) {
        const id = file.key.split('/')[1]
        if (UPLOAD_ID.test(id)) ids.add(id)
      }
      cursor = page.cursor
    } while (cursor)
    for (const id of ids) {
      if (locked.has(id)) continue
      const info = await loadInfo(id).catch(() => null)
      if (!info || new Date(info.expiresAt) < new Date()) await drop(id)
    }
  }

  return Object.assign(handler, { sweep, owns })
}

/**
 * Mounts {@link createTusHandler} at `path` on every runtime, after the
 * global middleware (so `cors()`, rate limits and `csrf()` apply — a browser
 * client sends the CSRF header through tus-js-client's `headers`). Sweeps
 * expired uploads hourly.
 */
export const TusAdapter = defineAdapter<TusOptions>({
  name: 'TusAdapter',
  build: (config) => {
    let handler: ReturnType<typeof createTusHandler> | undefined
    let timer: NodeJS.Timeout | undefined
    return {
      middleware: () => [
        {
          // Before the body parsers: claim the body, so Express's 415 for
          // types it doesn't parse leaves it alone (RAW_BODY in @forinda/kickjs).
          phase: 'beforeGlobal',
          handler: ((
            req: IncomingMessage & Record<symbol, unknown>,
            _res: unknown,
            next: () => void,
          ) => {
            if (handler?.owns(req)) req[RAW_BODY] = true
            next()
          }) as never,
        },
        {
          // After them: cors(), csrf() and rate limits have run.
          handler: ((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) =>
            handler ? void handler(req, res, next) : next()) as never,
        },
      ],
      beforeStart({ container }) {
        const resolve = (value: Storage | InjectionToken<Storage>) =>
          isStorage(value) ? value : container.resolve(value)
        handler = createTusHandler({
          ...config,
          storage: resolve(config.storage),
          partials: config.partials ? resolve(config.partials) : undefined,
        })
        timer = setInterval(() => void handler?.sweep().catch(() => {}), 60 * 60_000)
        timer.unref()
      },
      async shutdown() {
        clearInterval(timer)
      },
    }
  },
})

// Symbol.for, not an import, so this works with a @forinda/kickjs that predates it.
const RAW_BODY = Symbol.for('kick/http/raw-body')
