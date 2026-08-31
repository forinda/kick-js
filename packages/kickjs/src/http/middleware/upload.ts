import { HttpException, HttpStatus } from '../../core/errors'
import { unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { Options as MulterOptions } from 'multer'
import type { BaseUploadOptions, FileUploadConfig } from '../../core'

// `multer` is an optional peer dependency. We load it lazily via
// `createRequire` so importing this module never touches `multer` —
// only constructing an upload middleware does. Adopters who never
// call `upload.single/array/none()` or use `@FileUpload` don't need
// `multer` installed at all.
//
// multer uses CJS `export = multer`, so the module is itself the
// callable factory — no `.default` indirection on either the type
// or the runtime side.
const requireFromHere = createRequire(import.meta.url)
type MulterFactory = typeof import('multer')
let _multer: MulterFactory | undefined

function loadMulter(): MulterFactory {
  if (_multer) return _multer
  try {
    _multer = requireFromHere('multer') as MulterFactory
    return _multer
  } catch {
    throw new Error(
      "@forinda/kickjs: file uploads require the 'multer' package, which is not installed.\n" +
        'Install it as a peer dependency: pnpm add multer (or npm i multer / yarn add multer).',
    )
  }
}

// Pure upload core (MIME map, type filter, applyUploadConfig) moved to
// `./upload-config` so the edge-safe web entry can use it without this
// module's node-only surface. Re-exported here for compatibility.
export {
  buildFileTypeFilter,
  resolveMimeTypes,
  applyUploadConfig,
  type UploadedFileLike,
  type RawUploadPart,
} from './upload-config'
import { buildFileTypeFilter } from './upload-config'

/**
 * Upload options for the middleware.
 * Extends BaseUploadOptions from core (shared with @FileUpload decorator)
 * and adds Multer-specific storage options.
 */
export interface UploadOptions extends BaseUploadOptions {
  /** Multer storage config (default: memory storage) */
  storage?: MulterOptions['storage']
  /** Multer dest for disk storage shorthand */
  dest?: string
}

/**
 * Turn multer's own errors into the exceptions the other runtimes raise.
 *
 * multer reports a file over the limit as `MulterError: File too large`, a
 * plain error the handler maps to 500 — so an oversized upload was reported as
 * a server fault on Express while Fastify and h3 answered 413. The message is
 * matched to `applyUploadConfig` so the response does not depend on the engine.
 */
function translateMulterErrors(mw: RequestHandler, options: UploadOptions): RequestHandler {
  const maxSize = options.maxSize ?? 5 * 1024 * 1024
  return (req, res, next) => {
    mw(req, res, (err?: unknown) => {
      if (err && (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
        const name = (err as { field?: string }).field ?? 'file'
        return next(
          new HttpException(
            HttpStatus.PAYLOAD_TOO_LARGE,
            `File ${name} exceeds the ${maxSize}-byte limit`,
          ),
        )
      }
      next(err as never)
    })
  }
}

function createMulter(options: UploadOptions) {
  const limits: MulterOptions['limits'] = {
    fileSize: options.maxSize ?? 5 * 1024 * 1024,
  }

  let fileFilter: MulterOptions['fileFilter'] | undefined
  if (options.allowedTypes) {
    const typeAllowed = buildFileTypeFilter(options.allowedTypes, options.customMimeMap)
    fileFilter = (_req, file, cb) => {
      if (typeAllowed(file.mimetype, file.originalname)) {
        cb(null, true)
      } else {
        // Same exception the Fastify and h3 path raises from
        // `applyUploadConfig`. A plain Error here reached the handler as a 500,
        // so Express blamed itself for the client's file — and leaked a multer
        // stack doing it.
        cb(
          new HttpException(
            HttpStatus.UNSUPPORTED_MEDIA_TYPE,
            `File type ${file.mimetype} is not allowed`,
          ),
        )
      }
    }
  }

  const multerOptions: MulterOptions = {
    limits,
    ...(fileFilter ? { fileFilter } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.dest ? { dest: options.dest } : {}),
  }

  return loadMulter()(multerOptions)
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
  return translateMulterErrors(m.single(fieldName) as RequestHandler, options)
}

/**
 * Multiple file upload middleware. Attaches files to `req.files`.
 */
function array(fieldName: string, maxCount = 10, options: UploadOptions = {}): RequestHandler {
  const m = createMulter(options)
  return translateMulterErrors(m.array(fieldName, maxCount) as RequestHandler, options)
}

/**
 * No file upload — just parse multipart form data without file fields.
 */
function none(options: UploadOptions = {}): RequestHandler {
  const m = createMulter(options)
  return translateMulterErrors(m.none() as RequestHandler, options)
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
 * Accepts the same FileUploadConfig interface used by the @FileUpload decorator.
 */
export function buildUploadMiddleware(config: FileUploadConfig): RequestHandler {
  const options: UploadOptions = {}
  if (config.maxSize) options.maxSize = config.maxSize
  if (config.allowedTypes) options.allowedTypes = config.allowedTypes
  if (config.customMimeMap) options.customMimeMap = config.customMimeMap

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
