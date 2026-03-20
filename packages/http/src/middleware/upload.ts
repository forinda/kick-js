import { unlink } from 'node:fs/promises'
import type { Request, Response, NextFunction, RequestHandler } from 'express'
import multer, { type Options as MulterOptions } from 'multer'

/**
 * Maps short file extensions to their MIME types.
 * Users can pass `['jpg', 'png', 'pdf']` instead of full MIME strings.
 */
const MIME_MAP: Record<string, string> = {
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
 * File filter function — receives the MIME type and original filename,
 * returns `true` to accept or `false` to reject.
 */
export type FileFilterFn = (mimetype: string, filename: string) => boolean

export interface UploadOptions {
  /** Max file size in bytes (default: 5MB) */
  maxSize?: number
  /**
   * Allowed file types. Accepts:
   * - **string[]** — short extensions (`'jpg'`), full MIME types (`'image/jpeg'`), or wildcards (`'image/*'`)
   * - **function** — `(mimetype, filename) => boolean` for full control
   *
   * @example
   * ```ts
   * // Short extensions (resolved via built-in MIME map)
   * allowedTypes: ['jpg', 'png', 'pdf']
   *
   * // Full MIME types and wildcards
   * allowedTypes: ['image/*', 'application/pdf']
   *
   * // Custom filter function
   * allowedTypes: (mime, name) => mime.startsWith('image/') || name.endsWith('.heic')
   * ```
   */
  allowedTypes?: string[] | FileFilterFn
  /**
   * Extend or override the built-in extension-to-MIME map.
   * Merged with the defaults — your entries take precedence.
   *
   * @example
   * ```ts
   * customMimeMap: { heic: 'image/heic', jxl: 'image/jxl' }
   * ```
   */
  customMimeMap?: Record<string, string>
  /** Multer storage config (default: memory storage) */
  storage?: MulterOptions['storage']
  /** Multer dest for disk storage shorthand */
  dest?: string
}

function createMulter(options: UploadOptions) {
  const mimeMap = options.customMimeMap ? { ...MIME_MAP, ...options.customMimeMap } : MIME_MAP

  const limits: MulterOptions['limits'] = {
    fileSize: options.maxSize ?? 5 * 1024 * 1024,
  }

  let fileFilter: MulterOptions['fileFilter'] | undefined

  if (typeof options.allowedTypes === 'function') {
    // Custom filter function
    const filterFn = options.allowedTypes
    fileFilter = (_req, file, cb) => {
      if (filterFn(file.mimetype, file.originalname)) {
        cb(null, true)
      } else {
        cb(new Error(`File type ${file.mimetype} is not allowed`))
      }
    }
  } else if (Array.isArray(options.allowedTypes)) {
    // String array — resolve short extensions using the (possibly extended) MIME map
    const resolvedTypes = options.allowedTypes.map((t) => {
      const lower = t.toLowerCase().replace(/^\./, '')
      return mimeMap[lower] ?? t
    })
    fileFilter = (_req, file, cb) => {
      const allowed = resolvedTypes.some((type) => {
        if (type.endsWith('/*')) {
          return file.mimetype.startsWith(type.replace('/*', '/'))
        }
        return file.mimetype === type
      })
      if (allowed) {
        cb(null, true)
      } else {
        cb(new Error(`File type ${file.mimetype} is not allowed`))
      }
    }
  }

  const multerOptions: MulterOptions = {
    limits,
    ...(fileFilter ? { fileFilter } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.dest ? { dest: options.dest } : {}),
  }

  return multer(multerOptions)
}

/**
 * Single file upload middleware. Attaches the file to `req.file`.
 *
 * @example
 * ```ts
 * @Post('/avatar')
 * @Middleware(upload.single('avatar', { maxSize: 2 * 1024 * 1024, allowedTypes: ['jpg', 'png'] }))
 * async uploadAvatar(ctx: RequestContext) {
 *   ctx.json({ filename: ctx.file.originalname })
 * }
 * ```
 */
function single(fieldName: string, options: UploadOptions = {}): RequestHandler {
  const m = createMulter(options)
  return m.single(fieldName) as RequestHandler
}

/**
 * Multiple file upload middleware. Attaches files to `req.files`.
 */
function array(fieldName: string, maxCount = 10, options: UploadOptions = {}): RequestHandler {
  const m = createMulter(options)
  return m.array(fieldName, maxCount) as RequestHandler
}

/**
 * No file upload — just parse multipart form data without file fields.
 */
function none(options: UploadOptions = {}): RequestHandler {
  const m = createMulter(options)
  return m.none() as RequestHandler
}

/**
 * Removes temporary files from disk after the response is sent.
 * Attach this as Express middleware after the upload middleware.
 * Works with both `req.file` (single) and `req.files` (array).
 *
 * @example
 * ```ts
 * @Post('/process')
 * @Middleware(upload.single('document', { dest: '/tmp/uploads' }), cleanupFiles())
 * async processDocument(ctx: RequestContext) {
 *   ctx.json({ ok: true })
 * }
 * ```
 */
export function cleanupFiles() {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on('finish', async () => {
      const files: any[] = []

      if ((req as any).file?.path) {
        files.push((req as any).file)
      }
      if (Array.isArray((req as any).files)) {
        for (const f of (req as any).files) {
          if (f?.path) files.push(f)
        }
      }

      for (const file of files) {
        try {
          await unlink(file.path)
        } catch {
          // File may already be moved/deleted by the handler — ignore
        }
      }
    })

    next()
  }
}

/**
 * Build upload middleware from a @FileUpload decorator config.
 * Used internally by the router builder when it detects FILE_UPLOAD metadata.
 */
export function buildUploadMiddleware(config: {
  mode: 'single' | 'array' | 'none'
  fieldName?: string
  maxCount?: number
  maxSize?: number
  allowedMimeTypes?: string[]
}): RequestHandler {
  const options: UploadOptions = {}
  if (config.maxSize) options.maxSize = config.maxSize
  if (config.allowedMimeTypes) options.allowedTypes = config.allowedMimeTypes

  const fieldName = config.fieldName ?? 'file'

  switch (config.mode) {
    case 'single':
      return single(fieldName, options)
    case 'array':
      return array(fieldName, config.maxCount ?? 10, options)
    case 'none':
      return none(options)
  }
}

/** Upload middleware factory with `.single()`, `.array()`, `.none()` methods */
export const upload = { single, array, none }
