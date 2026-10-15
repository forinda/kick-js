import type { Body } from './keys'

/** Where an app keeps files. Every driver behaves the same for the same calls. */
export interface Storage {
  /**
   * Store `body` under `key`, replacing what was there. A stream is written
   * as it arrives: to disk directly, to a bucket in parts once it is larger
   * than one part.
   */
  put(key: string, body: Body, options?: PutOptions): Promise<void>
  /**
   * Store `body` only if nothing is stored under `key` yet: `true` when it was
   * stored, `false` when the key was taken. Atomic — of several callers, only
   * one gets `true`. For markers and small records: a stream is read into
   * memory first.
   */
  putIfAbsent(key: string, body: Body, options?: PutOptions): Promise<boolean>
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
