/**
 * File storage behind one interface — memory for tests, a directory on disk,
 * or an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) — so the code that
 * saves an avatar doesn't change when the app moves from one to another:
 *
 * ```ts
 * const files = process.env.NODE_ENV === 'production'
 *   ? s3Storage({ bucket: 'avatars', region: 'eu-west-1', accessKeyId, secretAccessKey })
 *   : diskStorage({ root: './uploads', baseUrl: '/uploads' })
 *
 * await files.put(`avatars/${user.id}.png`, ctx.file!.buffer, { contentType: 'image/png' })
 * const link = await files.url(`avatars/${user.id}.png`, { expiresIn: 600 })
 * ```
 *
 * @module @forinda/kickjs-storage
 */
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

import {
  checkKey,
  checkLimit,
  collect,
  encodeKey,
  isStream,
  pageOf,
  toBytes,
  type Body,
} from './keys'

export { checkKey, type Body } from './keys'
export {
  s3Storage,
  type CompletedPart,
  type Multipart,
  type S3Storage,
  type S3StorageOptions,
  type UploadedPart,
  type UploadUrlOptions,
} from './s3'

/** Where an app keeps files. Every driver behaves the same for the same calls. */
export interface Storage {
  /**
   * Store `body` under `key`, replacing what was there. A stream is written
   * as it arrives: to disk directly, to a bucket in parts once it is larger
   * than one part.
   */
  put(key: string, body: Body, options?: PutOptions): Promise<void>
  /** The bytes under `key`, or `null` when there are none. */
  get(key: string): Promise<Uint8Array | null>
  /** The file as a stream, for sending it on without holding it in memory; `null` when missing. */
  getStream(key: string): Promise<ReadableStream<Uint8Array> | null>
  /** Size, modification time and (buckets, memory) content type; `null` when missing. */
  stat(key: string): Promise<FileInfo | null>
  exists(key: string): Promise<boolean>
  /** Remove `key`. A key that isn't there is not an error. */
  delete(key: string): Promise<void>
  /**
   * Files whose key starts with `prefix`, in key order, a page at a time:
   * pass the returned `cursor` back for the next page; no `cursor` means the
   * last page. Not split into folders: `prefix: 'a/'` includes `a/b/c`.
   */
  list(options?: ListOptions): Promise<ListPage>
  /**
   * A URL a browser can load `key` from: signed and expiring for a bucket,
   * `baseUrl` + key for disk and memory (which throw without one).
   */
  url(key: string, options?: UrlOptions): Promise<string>
}

export interface PutOptions {
  /** Sent as `Content-Type` when the file is served. Buckets and memory keep it; disk doesn't. */
  contentType?: string
}

export interface UrlOptions {
  /** Seconds a signed URL stays valid. Default 3600, at most 604800 (7 days). */
  expiresIn?: number
}

export interface FileInfo {
  key: string
  size: number
  lastModified: Date
  contentType?: string
}

export interface ListOptions {
  prefix?: string
  /** From the previous page. */
  cursor?: string
  /** Files per page, 1 to 1000. Default 1000. */
  limit?: number
}

export interface ListPage {
  files: FileInfo[]
  /** Pass to the next `list()` call; absent on the last page. */
  cursor?: string
}

function publicUrl(driver: string, baseUrl: string | undefined, key: string) {
  if (baseUrl === undefined) {
    throw new Error(`${driver}: url() needs the \`baseUrl\` the files are served from`)
  }
  return `${baseUrl.replace(/\/+$/, '')}/${encodeKey(key)}`
}

export interface MemoryStorageOptions {
  /** Prefix for {@link Storage.url}. */
  baseUrl?: string
}

/** Files in a `Map`, for tests. Gone when the process exits. */
export function memoryStorage(options: MemoryStorageOptions = {}): Storage {
  const files = new Map<string, { bytes: Uint8Array; info: FileInfo }>()
  const read = (key: string) => {
    const file = files.get(checkKey(key))
    // Copied out, so a caller changing what it got can't change what's stored.
    return file ? Uint8Array.from(file.bytes) : null
  }
  return {
    async put(key, body, putOptions = {}) {
      checkKey(key)
      // Copied in, so a caller reusing its buffer can't change what's stored.
      const bytes = Uint8Array.from(await collect(body))
      const info = {
        key,
        size: bytes.length,
        lastModified: new Date(),
        contentType: putOptions.contentType,
      }
      files.set(key, { bytes, info })
    },
    async get(key) {
      return read(key)
    },
    async getStream(key) {
      const bytes = read(key)
      return bytes ? new Blob([bytes]).stream() : null
    },
    async stat(key) {
      const file = files.get(checkKey(key))
      return file ? { ...file.info } : null
    },
    async exists(key) {
      return files.has(checkKey(key))
    },
    async delete(key) {
      files.delete(checkKey(key))
    },
    async list(listOptions = {}) {
      const page = pageOf(
        files.keys(),
        listOptions.prefix ?? '',
        listOptions.cursor,
        checkLimit(listOptions.limit),
      )
      return { files: page.keys.map((key) => ({ ...files.get(key)!.info })), cursor: page.cursor }
    },
    async url(key) {
      return publicUrl('memoryStorage', options.baseUrl, key)
    },
  }
}

export interface DiskStorageOptions {
  /** The directory files live under; created on first write. */
  root: string
  /** Where the app serves `root` from, e.g. `/uploads` or a CDN origin, for {@link Storage.url}. */
  baseUrl?: string
}

// `put()` writes `<file>.<uuid>.tmp` and renames it; list() skips those.
const TEMP_FILE = /\.[0-9a-f-]{36}\.tmp$/

/** Files under a directory on local disk. */
export function diskStorage(options: DiskStorageOptions): Storage {
  const root = resolve(options.root)
  const pathOf = (key: string) => join(root, checkKey(key))
  const missing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT'
  const statOf = async (key: string): Promise<FileInfo | null> => {
    try {
      const info = await stat(pathOf(key))
      return info.isFile() ? { key, size: info.size, lastModified: info.mtime } : null
    } catch (err) {
      if (missing(err)) return null
      throw err
    }
  }
  return {
    async put(key, body) {
      const path = pathOf(key)
      await mkdir(dirname(path), { recursive: true })
      // Written aside, then renamed: a reader never sees half a file.
      const temp = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, isStream(body) ? body : toBytes(body))
        await rename(temp, path)
      } catch (err) {
        await rm(temp, { force: true })
        throw err
      }
    },
    async get(key) {
      try {
        return await readFile(pathOf(key))
      } catch (err) {
        if (missing(err)) return null
        throw err
      }
    },
    async getStream(key) {
      if (!(await statOf(key))) return null
      return Readable.toWeb(createReadStream(pathOf(key))) as ReadableStream<Uint8Array>
    },
    stat: statOf,
    async exists(key) {
      return (await statOf(key)) !== null
    },
    async delete(key) {
      await rm(pathOf(key), { force: true })
    },
    async list(listOptions = {}) {
      // ponytail: walks the whole tree for every page; fine for an upload
      // folder, use a bucket (or your database) for millions of files.
      let entries: string[]
      try {
        entries = await readdir(root, { recursive: true })
      } catch (err) {
        if (missing(err)) return { files: [] }
        throw err
      }
      // Skips temp files, and names no key could have (placed there by hand).
      const keys = entries
        .filter((entry) => !TEMP_FILE.test(entry))
        .map((entry) => entry.split(sep).join('/'))
        .filter((key) => {
          try {
            return checkKey(key) === key
          } catch {
            return false
          }
        })
      const prefix = listOptions.prefix ?? ''
      const files: FileInfo[] = []
      let cursor = listOptions.cursor
      const limit = checkLimit(listOptions.limit)
      // Directories are in `entries` too; take pages until enough are files.
      for (;;) {
        const page = pageOf(keys, prefix, cursor, limit - files.length)
        for (const key of page.keys) {
          const info = await statOf(key)
          if (info) files.push(info)
        }
        cursor = page.cursor
        if (!cursor || files.length === limit) return { files, cursor }
      }
    },
    async url(key) {
      return publicUrl('diskStorage', options.baseUrl, key)
    },
  }
}
