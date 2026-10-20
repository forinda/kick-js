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
   * one gets `true`. A stream is written as it arrives, as with `put()`.
   */
  putIfAbsent(key: string, body: Body, options?: PutOptions): Promise<boolean>
  /**
   * The bytes under `key`, or `null` when there are none. On disk, a key that
   * is a symbolic link, or leads outside the root through one, reads as missing.
   */
  get(key: string): Promise<Uint8Array | null>
  /**
   * The file as a stream, for sending it on without holding it in memory;
   * `null` when missing. With `range`, only those bytes — for answering an
   * HTTP `Range` request.
   */
  getStream(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array> | null>
  /** Size, modification time and (buckets, memory) content type; `null` when missing. */
  stat(key: string): Promise<FileInfo | null>
  exists(key: string): Promise<boolean>
  /** Remove `key`. A key that isn't there is not an error. */
  delete(key: string): Promise<void>
  /**
   * Files whose key starts with `prefix`, in key order, a page at a time:
   * pass the returned `cursor` back for the next page; no `cursor` means the
   * last page. Not split into folders (`prefix: 'a/'` includes `a/b/c`)
   * unless `delimiter` asks for it.
   */
  list(options?: ListOptions): Promise<ListPage>
  /**
   * A URL a browser can load `key` from: signed and expiring for a bucket,
   * `baseUrl` + key for disk and memory (which throw without one, and ignore
   * the response-header options — the app serving `baseUrl` sets those).
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
  /** Buckets: the `Content-Type` the file is served with through this URL. */
  contentType?: string
  /** Buckets: the `Content-Disposition` sent, e.g. `inline; filename="cat.png"`. */
  contentDisposition?: string
  /** Buckets: the `Cache-Control` sent. */
  cacheControl?: string
}

/**
 * Bytes `start` to `end`, both included, counted from 0 — as in an HTTP
 * `Range: bytes=start-end` header. `start` defaults to 0, `end` to the last
 * byte; an `end` past the file stops at its end, a `start` past it reads
 * nothing.
 */
export interface ByteRange {
  start?: number
  end?: number
}

export interface FileInfo {
  key: string
  size: number
  lastModified: Date
  contentType?: string
}

export interface ListOptions {
  prefix?: string
  /**
   * Group keys into folders: with `'/'`, `a/b/c` under prefix `a/` lists as
   * the prefix `a/b/` (in `prefixes`), not as a file. Like S3's delimiter.
   */
  delimiter?: string
  /** From the previous page. */
  cursor?: string
  /** Files (and prefixes) per page, 1 to 1000. Default 1000. */
  limit?: number
}

export interface ListPage {
  files: FileInfo[]
  /** With a `delimiter`: the folders, each once, ending in the delimiter. */
  prefixes?: string[]
  /** Pass to the next `list()` call; absent on the last page. */
  cursor?: string
}
