import {
  checkDelimiter,
  checkKey,
  checkLimit,
  checkRange,
  collect,
  listPage,
  publicUrl,
} from './keys'
import type { FileInfo, Storage } from './types'

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
    async putIfAbsent(key, body, putOptions) {
      if (files.has(checkKey(key))) return false
      // Read the body first, then claim the key in one synchronous step.
      const bytes = Uint8Array.from(await collect(body))
      if (files.has(key)) return false
      files.set(key, {
        bytes,
        info: {
          key,
          size: bytes.length,
          lastModified: new Date(),
          contentType: putOptions?.contentType,
        },
      })
      return true
    },
    async get(key) {
      return read(key)
    },
    async getStream(key, range) {
      const bytes = read(key)
      if (!bytes) return null
      const r = checkRange(range)
      return new Blob([
        r ? bytes.subarray(r.start, r.end === undefined ? undefined : r.end + 1) : bytes,
      ]).stream()
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
      const prefix = listOptions.prefix ?? ''
      const delimiter = checkDelimiter(listOptions.delimiter)
      const sorted = [...files.keys()].filter((key) => key.startsWith(prefix)).toSorted()
      async function* keysFrom(from: string | undefined) {
        let i = 0
        if (from !== undefined) {
          let high = sorted.length
          while (i < high) {
            const mid = (i + high) >>> 1
            if (sorted[mid] < from) i = mid + 1
            else high = mid
          }
        }
        for (; i < sorted.length; i++) yield sorted[i]
      }
      const page = await listPage(keysFrom, {
        prefix,
        cursor: listOptions.cursor,
        limit: checkLimit(listOptions.limit),
        delimiter,
      })
      return {
        files: page.keys.map((key) => ({ ...files.get(key)!.info })),
        ...(delimiter ? { prefixes: page.prefixes } : {}),
        ...(page.cursor ? { cursor: page.cursor } : {}),
      }
    },
    async url(key) {
      return publicUrl('memoryStorage', options.baseUrl, key)
    },
  }
}
