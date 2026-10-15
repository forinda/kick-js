import { checkKey, checkLimit, collect, pageOf, publicUrl } from './keys'
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
