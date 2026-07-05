// Pure (edge-safe) upload core — the engine-neutral half of the upload
// middleware. Extracted from `upload.ts` so the `@forinda/kickjs/web` entry
// graph can validate/shape buffered multipart parts WITHOUT dragging in
// upload.ts's node-only surface (multer peer loading via `node:module`,
// disk cleanup via `node:fs/promises`). `upload.ts` re-exports everything
// here, so existing import sites are unchanged.

import { HttpException, HttpStatus } from '../../core/errors'
import type { BaseUploadOptions, FileUploadConfig } from '../../core/decorators'

export const MIME_MAP: Record<string, string> = {
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  avif: 'image/avif',
  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  csv: 'text/csv',
  // Archives
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  // Other
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
}

/**
 * Resolves a list of file type identifiers to MIME type strings.
 * Accepts short extensions (`'jpg'`, `'pdf'`) or full MIME types (`'image/jpeg'`).
 *
 * @example
 * ```ts
 * resolveMimeTypes(['jpg', 'png', 'application/pdf'])
 * // → ['image/jpeg', 'image/png', 'application/pdf']
 * ```
 */
export function resolveMimeTypes(types: string[]): string[] {
  return types.map((t) => {
    const lower = t.toLowerCase().replace(/^\./, '')
    return MIME_MAP[lower] ?? t
  })
}

/**
 * Build a runtime-agnostic `(mimetype, filename) => boolean` file-type filter
 * from `allowedTypes` (a predicate, or a list of extensions / MIME types /
 * wildcards). Returned by both the multer middleware (Express) and the
 * Fastify / h3 / web multipart paths so the accept/reject rule stays
 * identical across engines. No `allowedTypes` → accept everything.
 */
export function buildFileTypeFilter(
  allowedTypes: BaseUploadOptions['allowedTypes'],
  customMimeMap?: Record<string, string>,
): (mimetype: string, filename: string) => boolean {
  if (!allowedTypes) return () => true
  if (typeof allowedTypes === 'function') return allowedTypes
  const mimeMap = customMimeMap ? { ...MIME_MAP, ...customMimeMap } : MIME_MAP
  const resolved = allowedTypes.map((t) => mimeMap[t.toLowerCase().replace(/^\./, '')] ?? t)
  return (mimetype: string) =>
    resolved.some((type) =>
      type.endsWith('/*') ? mimetype.startsWith(type.replace('/*', '/')) : mimetype === type,
    )
}

/** A multer-shaped uploaded file — what `ctx.file` / `ctx.files` expose. */
export interface UploadedFileLike {
  fieldname: string
  originalname: string
  encoding: string
  mimetype: string
  size: number
  buffer: Buffer
}

/** A buffered multipart file part, as the runtime hands it to {@link applyUploadConfig}. */
export interface RawUploadPart {
  fieldname: string
  filename: string
  mimetype: string
  buffer: Buffer
}

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024

/**
 * Apply a `@FileUpload` config to already-buffered multipart parts and return
 * the multer-shaped `file` / `files` for `ctx`. Enforces the field name, type
 * filter, per-file size limit, and (array mode) max count — throwing
 * `HttpException` on a violation, mirroring the Express/multer error path.
 * Used by the Fastify, h3 and web runtimes; Express keeps using multer directly.
 */
export function applyUploadConfig(
  parts: RawUploadPart[],
  config: FileUploadConfig,
): { file?: UploadedFileLike; files?: UploadedFileLike[] } {
  if (config.mode === 'none') return {}

  const field = config.fieldName ?? 'file'
  const maxSize = config.maxSize ?? DEFAULT_MAX_SIZE
  const typeAllowed = buildFileTypeFilter(config.allowedTypes, config.customMimeMap)

  const matched = parts.filter((p) => p.fieldname === field)
  const files: UploadedFileLike[] = matched.map((p) => {
    if (!typeAllowed(p.mimetype, p.filename)) {
      throw new HttpException(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        `File type ${p.mimetype} is not allowed`,
      )
    }
    if (p.buffer.length > maxSize) {
      throw new HttpException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        `File ${p.filename} exceeds the ${maxSize}-byte limit`,
      )
    }
    return {
      fieldname: p.fieldname,
      originalname: p.filename,
      encoding: '7bit',
      mimetype: p.mimetype,
      size: p.buffer.length,
      buffer: p.buffer,
    }
  })

  if (config.mode === 'single') return { file: files[0] }
  const maxCount = config.maxCount ?? 10
  return { files: files.slice(0, maxCount) }
}
