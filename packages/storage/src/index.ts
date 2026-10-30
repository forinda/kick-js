/**
 * File storage behind one interface — memory for tests, a directory on disk,
 * or an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) — so the code that
 * saves an avatar doesn't change when the app moves from one to another:
 *
 * ```ts
 * // Pick the driver from an explicit setting, not NODE_ENV: a deploy that
 * // forgot NODE_ENV would otherwise write uploads to the container's disk.
 * const files = getEnv('S3_BUCKET')
 *   ? s3Storage({ bucket: getEnv('S3_BUCKET'), region: 'eu-west-1', accessKeyId, secretAccessKey })
 *   : diskStorage({ root: './uploads', baseUrl: '/uploads' }) // from '@forinda/kickjs-storage/disk'
 *
 * await files.put(`avatars/${user.id}.png`, ctx.file!.buffer, { contentType: 'image/png' })
 * const link = await files.url(`avatars/${user.id}.png`, { expiresIn: 600 })
 * ```
 *
 * This entry runs anywhere `fetch` and WebCrypto do — Node, Bun, Deno,
 * Cloudflare Workers. `diskStorage` (Node only) is `@forinda/kickjs-storage/disk`.
 *
 * @module @forinda/kickjs-storage
 */
// The checks every driver makes, for writing your own: the same errors the built-in ones throw.
export {
  checkDelimiter,
  checkKey,
  checkLimit,
  checkRange,
  collect,
  encodeKey,
  type Body,
} from './keys'
export { memoryStorage, type MemoryStorageOptions } from './memory'
export {
  s3Storage,
  type CompletedPart,
  type S3Credentials,
  type Multipart,
  type S3Storage,
  type S3StorageOptions,
  type UploadedPart,
  type UploadForm,
  type UploadFormOptions,
  type UploadUrlOptions,
} from './s3'
export type {
  ByteRange,
  FileInfo,
  ListOptions,
  ListPage,
  PutOptions,
  Storage,
  UrlOptions,
} from './types'
