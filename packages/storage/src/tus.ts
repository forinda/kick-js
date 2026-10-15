/**
 * Resumable uploads through your own server, over the tus protocol
 * (https://tus.io) — for clients like `tus-js-client` and Uppy's `@uppy/tus`.
 * An upload is written to a local directory as it arrives; a dropped
 * connection keeps what was received, and the client resumes from there.
 * Once complete, the file moves into any {@link Storage} — disk, memory or a
 * bucket:
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
 * Supports tus 1.0.0 with the creation, creation-with-upload, termination
 * and expiration extensions.
 *
 * @module @forinda/kickjs-storage/tus
 */
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { defineAdapter, type InjectionToken } from '@forinda/kickjs'
import type { Storage } from './types'
import { checkKey } from './keys'

const VERSION = '1.0.0'
const EXTENSIONS = 'creation,creation-with-upload,termination,expiration'
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** An upload in progress, or just completed. */
export interface TusUpload {
  id: string
  /** Where the file goes in the storage once complete. */
  key: string
  /** Total size in bytes, from `Upload-Length`. */
  size: number
  /** Bytes received so far. */
  offset: number
  /** `Upload-Metadata`, decoded — `filename`, `filetype`, whatever the client sends. */
  metadata: Record<string, string>
  /** What `onCreate` returned as `data`, e.g. the owner's id, for `authorize`. */
  data?: unknown
  /** When an unfinished upload is dropped. Moves forward with every PATCH. */
  expiresAt: Date
}

/** What the client asked to create. */
export interface TusCreateRequest {
  headers: IncomingHttpHeaders
  size: number
  metadata: Record<string, string>
}

export interface TusOptions {
  /** The upload endpoint, e.g. `'/api/uploads'`. Uploads live at `<path>/<id>`. */
  path: string
  /** Where completed files go: a `Storage`, or a DI token bound to one. */
  storage: Storage | InjectionToken<Storage>
  /**
   * The directory unfinished uploads are written to, relative to
   * `process.cwd()`. Default `'.tus'`. It must survive restarts, and with
   * several instances every one must see it (a shared volume) or the load
   * balancer must send an upload's requests to one instance.
   */
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
   * Check every later request (HEAD, PATCH, DELETE) to an upload — e.g. that
   * the caller is the user who created it, from `upload.data`. Throw an
   * `HttpException` to refuse. Without it, anyone holding the upload URL
   * (an unguessable id) can continue or cancel it.
   */
  authorize?(headers: IncomingHttpHeaders, upload: TusUpload): void | Promise<void>
  /**
   * Runs once the file is in the storage — record it in your database. If it
   * throws, the client gets a 500 and its retry runs it again, so it runs at
   * least once: make it idempotent (an upsert keyed by `upload.id`).
   */
  onComplete?(upload: TusUpload): void | Promise<void>
}

type Info = Omit<TusUpload, 'offset' | 'expiresAt'> & {
  expiresAt: string
  /** The raw `Upload-Metadata`, returned as-is on HEAD. */
  rawMetadata?: string
  done?: boolean
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

/** Throws once more than `limit` bytes pass through. */
function capped(limit: number) {
  let seen = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length
      if (seen > limit) callback(new TusError(413, 'Body is larger than the rest of the upload'))
      else callback(null, chunk)
    },
  })
}

/**
 * The tus endpoint as a Node `(req, res, next)` handler. Requests outside
 * `path` go to `next`. {@link TusAdapter} mounts it on every runtime; use this
 * directly to put it in front of another server.
 */
export function createTusHandler(options: Omit<TusOptions, 'storage'> & { storage: Storage }) {
  const base = options.path.replace(/\/+$/, '')
  const dir = resolve(options.dir ?? '.tus')
  const maxSize = options.maxSize ?? 1024 ** 3
  const expiresIn = (options.expiresIn ?? 86_400) * 1000
  // ponytail: in-process lock; with several instances, route an upload's requests to one.
  const locked = new Set<string>()
  const ready = mkdir(dir, { recursive: true })

  const dataPath = (id: string) => join(dir, id)
  const infoPath = (id: string) => join(dir, `${id}.json`)

  async function load(id: string): Promise<{ info: Info; upload: TusUpload } | null> {
    let info: Info
    try {
      info = JSON.parse(await readFile(infoPath(id), 'utf8')) as Info
    } catch {
      return null
    }
    if (new Date(info.expiresAt) < new Date()) {
      // Not while a request holds it; that request just answers 404.
      if (!locked.has(id)) await drop(id)
      return null
    }
    const offset = info.done
      ? info.size
      : await stat(dataPath(id)).then(
          (s) => s.size,
          () => 0,
        )
    return { info, upload: { ...info, offset, expiresAt: new Date(info.expiresAt) } }
  }

  const save = (info: Info) => writeFile(infoPath(info.id), JSON.stringify(info))
  const drop = (id: string) =>
    Promise.all([rm(dataPath(id), { force: true }), rm(infoPath(id), { force: true })])

  /** Append the request body; resolves with the new offset. Bytes received before a disconnect stay. */
  async function append(req: IncomingMessage, id: string, room: number) {
    await pipeline(req, capped(room), createWriteStream(dataPath(id), { flags: 'a' }))
    return (await stat(dataPath(id))).size
  }

  /**
   * Move a complete upload into the storage, run `onComplete`, then mark it
   * done. A failure anywhere leaves it not done: the client's retry (a PATCH
   * at the final offset) runs all of it again — so `onComplete` runs at least
   * once, and more than once if it, or marking done, fails after it ran.
   */
  async function finish(info: Info) {
    const { rawMetadata: _, done: __, expiresAt, ...rest } = info
    await options.storage.put(info.key, createReadStream(dataPath(info.id)), {
      contentType: info.metadata.filetype || info.metadata.contentType || undefined,
    })
    await options.onComplete?.({ ...rest, offset: info.size, expiresAt: new Date(expiresAt) })
    await save({ ...info, done: true })
    await rm(dataPath(info.id), { force: true })
  }

  const touch = (info: Info) => ({
    ...info,
    expiresAt: new Date(Date.now() + expiresIn).toISOString(),
  })

  async function handle(req: IncomingMessage, res: ServerResponse, id: string | undefined) {
    const send = (status: number, headers: Record<string, string> = {}, body?: string) => {
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
      })
    }
    if (header(req, 'tus-resumable') !== VERSION) {
      return send(412, { 'Tus-Version': VERSION }, 'Unsupported Tus-Resumable version')
    }
    await ready

    if (id === undefined) {
      if (method !== 'POST') return send(405, { Allow: 'OPTIONS, POST' })
      const size = intHeader(req, 'upload-length')
      if (size === undefined) throw new TusError(400, 'Upload-Length is required')
      if (size > maxSize) throw new TusError(413, `Upload is larger than ${maxSize} bytes`)
      const rawMetadata = header(req, 'upload-metadata')
      const metadata = parseMetadata(rawMetadata)
      const newId = randomUUID()
      const chosen =
        (await options.onCreate?.({ headers: req.headers, size, metadata }, newId)) ?? {}
      const info: Info = touch({
        id: newId,
        key: checkKey(chosen.key ?? `uploads/${newId}`),
        size,
        metadata,
        rawMetadata,
        data: chosen.data,
        expiresAt: '',
      })
      await writeFile(dataPath(newId), '')
      await save(info)
      const headers: Record<string, string> = {
        Location: `${base}/${newId}`,
        'Upload-Expires': new Date(info.expiresAt).toUTCString(),
      }
      // creation-with-upload: the first bytes ride along with the POST.
      if (header(req, 'content-type') === 'application/offset+octet-stream') {
        locked.add(newId)
        try {
          const offset = await append(req, newId, size)
          if (offset === size) await finish(info)
          headers['Upload-Offset'] = String(offset)
        } finally {
          locked.delete(newId)
        }
      } else if (size === 0) {
        await finish(info)
      }
      return send(201, headers)
    }

    if (method === 'HEAD') {
      const found = await load(id)
      if (!found) return send(404, {}, 'Upload not found')
      const { info, upload } = found
      await options.authorize?.(req.headers, upload)
      return send(200, {
        'Upload-Offset': String(upload.offset),
        'Upload-Length': String(upload.size),
        ...(info.rawMetadata ? { 'Upload-Metadata': info.rawMetadata } : {}),
        'Cache-Control': 'no-store',
        ...(info.done ? {} : { 'Upload-Expires': upload.expiresAt.toUTCString() }),
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
      const { info, upload } = found
      await options.authorize?.(req.headers, upload)

      if (method === 'DELETE') {
        await drop(id)
        return send(204)
      }
      if (header(req, 'content-type') !== 'application/offset+octet-stream') {
        throw new TusError(415, 'Content-Type must be application/offset+octet-stream')
      }
      const offset = intHeader(req, 'upload-offset')
      if (offset !== upload.offset) {
        throw new TusError(409, `Upload-Offset must be ${upload.offset}`)
      }
      if (info.done) return send(204, { 'Upload-Offset': String(upload.size) })
      const next = touch(info)
      await save(next)
      const received = await append(req, id, upload.size - upload.offset)
      if (received === upload.size) await finish(next)
      return send(204, {
        'Upload-Offset': String(received),
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
      // Ids are UUIDs: anything else is not an upload, and never a path on disk.
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
      // The client went away mid-PATCH: what arrived is kept, and it resumes from there.
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

  /** Remove unfinished uploads past their expiry, and finished ones' records. */
  async function sweep() {
    const names = await readdir(dir).catch(() => [] as string[])
    for (const name of names) {
      const id = name.replace(/\.json$/, '')
      if (name.endsWith('.json') && UPLOAD_ID.test(id) && !locked.has(id)) await load(id)
    }
  }

  return Object.assign(handler, { sweep, owns })
}

// Symbol.for, not an import, so this works with a @forinda/kickjs that predates it.
const RAW_BODY = Symbol.for('kick/http/raw-body')

const isStorage = (value: unknown): value is Storage =>
  typeof (value as Storage | undefined)?.put === 'function'

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
        const storage = isStorage(config.storage)
          ? config.storage
          : container.resolve(config.storage)
        handler = createTusHandler({ ...config, storage })
        timer = setInterval(() => void handler?.sweep(), 60 * 60_000)
        timer.unref()
      },
      async shutdown() {
        clearInterval(timer)
      },
    }
  },
})
