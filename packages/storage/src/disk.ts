/**
 * Files under a directory on local disk. Node only — a separate entry so the
 * main one stays usable on edge runtimes:
 *
 * ```ts
 * import { diskStorage } from '@forinda/kickjs-storage/disk'
 * ```
 *
 * @module @forinda/kickjs-storage/disk
 */
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  link,
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
import { checkKey, checkLimit, collect, isStream, publicUrl, toBytes } from './keys'
import type { FileInfo, Storage } from './types'

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

/**
 * Keys under `dir` in key order, from just after `after`, matching `prefix` —
 * reading only the folders that can hold such keys, so a page costs the
 * folders along its path, not the whole tree.
 *
 * Key order is string order of the full key. A folder `a` holds keys
 * starting `a/`, so it sorts as `a/` against its siblings (`a-b` < `a/` <
 * `a0`), which visits files and folders in the order their keys sort.
 */
async function* keysInOrder(
  dir: string,
  base: string,
  prefix: string,
  after: string | undefined,
): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  const sorted = entries
    .filter((entry) => entry.isFile() || entry.isDirectory())
    .map((entry) => ({
      entry,
      key: base + entry.name,
      sortAs: base + entry.name + (entry.isDirectory() ? '/' : ''),
    }))
    .toSorted((a, b) => (a.sortAs < b.sortAs ? -1 : a.sortAs > b.sortAs ? 1 : 0))
  for (const { entry, key, sortAs } of sorted) {
    if (entry.isDirectory()) {
      // Every key inside starts with `sortAs`: skip the folder if none can match the prefix…
      if (!sortAs.startsWith(prefix) && !prefix.startsWith(sortAs)) continue
      // …or all of them sort at or before the cursor (they all sort before `<folder>0`).
      if (after !== undefined && after >= `${key}0`) continue
      yield* keysInOrder(join(dir, entry.name), sortAs, prefix, after)
    } else if (
      key.startsWith(prefix) &&
      (after === undefined || key > after) &&
      !TEMP_FILE.test(key) &&
      isKey(key)
    ) {
      yield key
    }
  }
}

/** Whether a name found on disk is a valid key (files placed by hand may not be). */
function isKey(key: string) {
  try {
    return checkKey(key) === key
  } catch {
    return false
  }
}

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
    async putIfAbsent(key, body) {
      const path = await writable(key)
      const temp = `${path}.${randomUUID()}.tmp`
      await writeFile(temp, await collect(body))
      try {
        // link() fails if the name exists — an atomic create-only.
        await link(temp, path)
        return true
      } catch (err) {
        if (code(err) === 'EEXIST') return false
        if (['EISDIR', 'EPERM'].includes(code(err))) throw conflict(key)
        throw err
      } finally {
        await rm(temp, { force: true })
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
      const prefix = listOptions.prefix ?? ''
      const after = listOptions.cursor
      const limit = checkLimit(listOptions.limit)
      const files: FileInfo[] = []
      // One more than a page: if it exists, there is a next page.
      for await (const key of keysInOrder(root, '', prefix, after)) {
        if (files.length === limit) return { files, cursor: files.at(-1)!.key }
        const info = await statOf(key).catch(() => null)
        if (info) files.push(info)
      }
      return { files }
    },
    async url(key) {
      return publicUrl('diskStorage', options.baseUrl, key)
    },
  }
}
