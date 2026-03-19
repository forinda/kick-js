import { unlink } from 'node:fs/promises'
import type { Request, Response, NextFunction, RequestHandler } from 'express'
import multer, { type Options as MulterOptions } from 'multer'

export interface UploadOptions {
  /** Max file size in bytes (default: 5MB) */
  maxSize?: number
  /** Allowed MIME types (default: all) */
  allowedTypes?: string[]
  /** Multer storage config (default: memory storage) */
  storage?: MulterOptions['storage']
  /** Multer dest for disk storage shorthand */
  dest?: string
}

/**
 * Single file upload middleware. Attaches the file to `req.file`.
 *
 * @example
 * ```ts
 * @Post('/avatar')
 * @Middleware(upload.single('avatar', { maxSize: 2 * 1024 * 1024, allowedTypes: ['image/*'] }))
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

function createMulter(options: UploadOptions) {
  const limits: MulterOptions['limits'] = {
    fileSize: options.maxSize ?? 5 * 1024 * 1024,
  }

  const fileFilter: MulterOptions['fileFilter'] = options.allowedTypes
    ? (_req, file, cb) => {
        const allowed = options.allowedTypes!.some((type) => {
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
    : undefined

  const multerOptions: MulterOptions = {
    limits,
    ...(fileFilter ? { fileFilter } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.dest ? { dest: options.dest } : {}),
  }

  return multer(multerOptions)
}

/**
 * Middleware that automatically cleans up uploaded files after the response
 * is sent. Attach this AFTER your upload middleware.
 *
 * Only cleans up disk-stored files (files with a `path` property).
 *
 * @example
 * ```ts
 * middleware: [
 *   upload.single('file', { dest: '/tmp/uploads' }),
 *   cleanupFiles(),
 * ]
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

/** Upload middleware factory with `.single()`, `.array()`, `.none()` methods */
export const upload = { single, array, none }
