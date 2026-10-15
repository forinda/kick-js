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
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
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
  /**
   * The directory files live under; created on first write. A relative path
   * resolves from `process.cwd()` when the storage is created, the same base
   * as env files and assets.
   */
  root: string
  /** Where the app serves `root` from, e.g. `/uploads` or a CDN origin, for {@link Storage.url}. */
  baseUrl?: string
}

// `put()` writes `<file>.<uuid>.tmp` and renames it; list() skips those.
const TEMP_FILE = /\.[0-9a-f-]{36}\.tmp$/

/** Files under a directory on local disk. */
export function diskStorage(options: DiskStorageOptions): Storage {
  const root = resolve(options.root)
  // ENOTDIR: a parent of the key is a file (`a` exists, reading `a/b`) — also "no such file".
  const missing = (err: unknown) =>
    ['ENOENT', 'ENOTDIR'].includes((err as NodeJS.ErrnoException).code ?? '')
  const code = (err: unknown) => (err as NodeJS.ErrnoException).code ?? ''

  /**
   * The real folder must be under the real root: a symbolic link inside the
   * root (`root/link -> /etc`) would otherwise let the valid key `link/passwd`
   * read, replace or delete a file outside it.
   */
  async function assertInside(dir: string, key: string) {
    const [real, base] = await Promise.all([realpath(dir), realpath(root)])
    if (real !== base && !real.startsWith(base + sep)) {
      throw new Error(`diskStorage: '${key}' leads outside the root through a symbolic link`)
    }
  }

  /** The path for reading `key`, or null when the file (or a folder above it) doesn't exist. */
  async function readable(key: string): Promise<string | null> {
    const path = join(root, checkKey(key))
    let info
    try {
      await assertInside(dirname(path), key)
      info = await lstat(path)
    } catch (err) {
      if (missing(err)) return null
      throw err
    }
    if (info.isSymbolicLink()) {
      throw new Error(`diskStorage: '${key}' is a symbolic link, which isn't followed`)
    }
    return info.isFile() ? path : null
  }

  // A key can't be both a file and a folder on disk; buckets and memory allow it.
  const conflict = (key: string) =>
    new Error(`diskStorage: '${key}' clashes with an existing file or folder of the same name`)

  /** The path for writing `key`, its folders created — none of them through a link. */
  async function writable(key: string): Promise<string> {
    const path = join(root, checkKey(key))
    await mkdir(root, { recursive: true })
    // Check the deepest folder that exists before creating the rest: mkdir
    // follows links, so checking afterwards would be too late.
    let existing = dirname(path)
    for (;;) {
      try {
        await lstat(existing)
        break
      } catch (err) {
        if (!missing(err)) throw err
        existing = dirname(existing)
      }
    }
    try {
      await assertInside(existing, key)
      await mkdir(dirname(path), { recursive: true })
      await assertInside(dirname(path), key)
    } catch (err) {
      if (['EEXIST', 'ENOTDIR'].includes(code(err))) throw conflict(key)
      throw err
    }
    return path
  }

  const statOf = async (key: string): Promise<FileInfo | null> => {
    const path = await readable(key)
    if (!path) return null
    const info = await stat(path)
    return { key, size: info.size, lastModified: info.mtime }
  }
  return {
    async put(key, body) {
      const path = await writable(key)
      // Written aside, then renamed: a reader never sees half a file.
      const temp = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, isStream(body) ? body : toBytes(body))
        await rename(temp, path)
      } catch (err) {
        await rm(temp, { force: true })
        if (['EISDIR', 'ENOTEMPTY', 'EEXIST'].includes(code(err))) throw conflict(key)
        throw err
      }
    },
    async get(key) {
      const path = await readable(key)
      return path ? readFile(path) : null
    },
    async getStream(key) {
      const path = await readable(key)
      return path ? (Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>) : null
    },
    stat: statOf,
    async exists(key) {
      return (await statOf(key)) !== null
    },
    async delete(key) {
      const path = join(root, checkKey(key))
      try {
        await assertInside(dirname(path), key)
      } catch (err) {
        if (missing(err)) return
        throw err
      }
      // rm removes a link itself, never what it points to.
      await rm(path, { force: true })
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
          // Links aren't followed, so they aren't listed either.
          const info = await statOf(key).catch(() => null)
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
