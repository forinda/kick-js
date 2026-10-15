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
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import { checkKey, encodeKey, toBytes } from './keys'

export { checkKey } from './keys'
export { s3Storage, type S3StorageOptions } from './s3'

/** Where an app keeps files. Every driver behaves the same for the same calls. */
export interface Storage {
  /** Store `body` under `key`, replacing what was there. */
  put(key: string, body: Uint8Array | string, options?: PutOptions): Promise<void>
  /** The bytes under `key`, or `null` when there are none. */
  get(key: string): Promise<Uint8Array | null>
  exists(key: string): Promise<boolean>
  /** Remove `key`. A key that isn't there is not an error. */
  delete(key: string): Promise<void>
  /**
   * A URL a browser can load `key` from: signed and expiring for a bucket,
   * `baseUrl` + key for disk and memory (which throw without one).
   */
  url(key: string, options?: UrlOptions): Promise<string>
}

export interface PutOptions {
  /** Sent as `Content-Type` when the file is served. Buckets keep it; disk and memory don't. */
  contentType?: string
}

export interface UrlOptions {
  /** Seconds a signed URL stays valid. Default 3600, at most 604800 (7 days). */
  expiresIn?: number
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
  const files = new Map<string, Uint8Array>()
  return {
    async put(key, body) {
      // Copied in and out, so a caller reusing its buffer can't change what's stored.
      files.set(checkKey(key), Uint8Array.from(toBytes(body)))
    },
    async get(key) {
      const bytes = files.get(checkKey(key))
      return bytes ? Uint8Array.from(bytes) : null
    },
    async exists(key) {
      return files.has(checkKey(key))
    },
    async delete(key) {
      files.delete(checkKey(key))
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

/** Files under a directory on local disk. */
export function diskStorage(options: DiskStorageOptions): Storage {
  const root = resolve(options.root)
  const pathOf = (key: string) => join(root, checkKey(key))
  const missing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT'
  return {
    async put(key, body) {
      const path = pathOf(key)
      await mkdir(dirname(path), { recursive: true })
      // Written aside, then renamed: a reader never sees half a file.
      const temp = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, toBytes(body))
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
    async exists(key) {
      try {
        return (await stat(pathOf(key))).isFile()
      } catch (err) {
        if (missing(err)) return false
        throw err
      }
    },
    async delete(key) {
      await rm(pathOf(key), { force: true })
    },
    async url(key) {
      return publicUrl('diskStorage', options.baseUrl, key)
    },
  }
}
