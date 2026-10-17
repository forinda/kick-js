import { HttpException, HttpStatus } from '../../core/errors'
import { unlink } from 'node:fs/promises'
import type {
  ConnectRequest as Request,
  ConnectResponse as Response,
  ConnectNext as NextFunction,
  ConnectHandler as RequestHandler,
} from '../connect'
import type { Options as MulterOptions } from 'multer'
import type { BaseUploadOptions, FileUploadConfig } from '../../core'

// `multer` is an optional peer dependency, imported when the first upload
// arrives — adopters who never take uploads don't need it installed. An
// `import()`, not `createRequire`: a bundler follows it, so a Netlify or
// Vercel function built by `kick build:*` carries multer with it.
type MulterFactory = typeof import('multer')
type Multer = ReturnType<MulterFactory>
let _multer: Promise<MulterFactory> | undefined

function loadMulter(): Promise<MulterFactory> {
  return (_multer ??= import('multer').then(
    // multer is CJS `export = multer`: the factory is the module's default.
    (mod) => ((mod as { default?: unknown }).default ?? mod) as MulterFactory,
    () => {
      throw new Error(
        "@forinda/kickjs: file uploads require the 'multer' package, which is not installed. " +
          'Add it to your dependencies.',
      )
    },
  ))
}

// Pure upload core (MIME map, type filter, applyUploadConfig) moved to
// `./upload-config` so the edge-safe web entry can use it without this
// module's node-only surface. Re-exported here for compatibility.
export {
  buildFileTypeFilter,
  resolveMimeTypes,
  applyUploadConfig,
  type UploadedFileLike,
  type UploadedFile,
  type UploadStorageEngine,
  type RawUploadPart,
} from './upload-config'
import { Transform, type Writable } from 'node:stream'
import { tooLarge } from '../body-policy'
import {
  MAX_UPLOAD_FIELDS,
  UPLOAD_FIELDS_ALLOWANCE,
  buildFileTypeFilter,
  normalizeOriginalName,
  serverFileName,
  tooManyFiles,
  uploadLimits,
  type UploadedFile,
  type UploadStorageEngine,
} from './upload-config'

/**
 * Upload options for the middleware.
 * Extends BaseUploadOptions from core (shared with @FileUpload decorator)
 * and adds Multer-specific storage options.
 */
export interface UploadOptions extends BaseUploadOptions {
  /** Multer storage engine (default: memory storage) */
  storage?: UploadStorageEngine
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
function translateMulterErrors(
  mw: RequestHandler,
  options: UploadOptions,
  files?: { field: string; max: number },
): RequestHandler {
  const maxSize = options.maxSize ?? 5 * 1024 * 1024
  return (req, res, next) => {
    mw(req, res, (err?: unknown) => {
      // multer reports one file more than the field takes as an unexpected one.
      if (
        files &&
        (err as { code?: string } | undefined)?.code === 'LIMIT_UNEXPECTED_FILE' &&
        (err as { field?: string }).field === files.field
      ) {
        return next(tooManyFiles(files.max))
      }
      if (err && (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
        const name = (err as { field?: string }).field ?? 'file'
        return next(
          new HttpException(
            HttpStatus.PAYLOAD_TOO_LARGE,
            `File ${name} exceeds the ${maxSize}-byte limit`,
          ),
        )
      }
      if (!err) {
        try {
          nameUploads(req as { file?: unknown; files?: unknown }, options.rename)
        } catch (error) {
          return next(error as never)
        }
      }
      next(err as never)
    })
  }
}

/**
 * The names every engine gives an upload: the client's name normalized, and a
 * server-side `filename` — kept when disk storage already wrote the file under one.
 */
function nameUploads(req: { file?: unknown; files?: unknown }, rename: UploadOptions['rename']) {
  const files = [req.file, ...(Array.isArray(req.files) ? req.files : [])]
  for (const file of files as Array<UploadedFile | undefined>) {
    if (!file) continue
    file.originalname = normalizeOriginalName(file.originalname)
    file.filename ??= serverFileName(file, rename)
  }
}

function createMulter(options: UploadOptions) {
  const limits: MulterOptions['limits'] = {
    fileSize: options.maxSize ?? 5 * 1024 * 1024,
    fields: MAX_UPLOAD_FIELDS,
    fieldSize: UPLOAD_FIELDS_ALLOWANCE,
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
    // busboy reads a part's filename as latin1 unless told otherwise, so a
    // UTF-8 name — 中文, an emoji — arrived as mojibake ("ä¸­æ").
    defParamCharset: 'utf8',
    ...(fileFilter ? { fileFilter } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.dest ? { dest: options.dest } : {}),
  }

  // Built on the first request that needs it, then reused.
  let built: Promise<Multer> | undefined
  const lazy = (pick: (multer: Multer) => RequestHandler): RequestHandler => {
    let handler: Promise<RequestHandler> | undefined
    return (req, res, next) => {
      handler ??= (built ??= loadMulter().then((multer) => multer(multerOptions))).then(pick)
      handler.then(
        (run) => run(req, res, next),
        (err) => {
          // Not cached: multer installed while `kick dev` runs works on the next upload.
          handler = built = _multer = undefined
          next(err)
        },
      )
    }
  }
  return {
    single: (field: string) => lazy((m) => m.single(field) as RequestHandler),
    array: (field: string, maxCount: number) =>
      lazy((m) => m.array(field, maxCount) as RequestHandler),
    none: () => lazy((m) => m.none() as RequestHandler),
  }
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
/**
 * The handler, callable both ways it gets used: as Express middleware
 * `(req, res, next)` — `middlewares: [upload.single(...)]`, and what
 * `@FileUpload` builds — and as a route middleware `(ctx, next)`, which is
 * how `@Middleware(upload.single(...))` calls it. Called the second way,
 * Multer got the context as its request and failed on every upload.
 */
function bothConventions(handler: RequestHandler): RequestHandler {
  return ((first: any, second: any, third?: any) => {
    const isRouteMiddleware =
      third === undefined &&
      typeof second === 'function' &&
      first !== null &&
      typeof first === 'object' &&
      'req' in first &&
      'res' in first
    if (!isRouteMiddleware) return handler(first, second, third)
    return new Promise<void>((resolve, reject) => {
      handler(first.req, first.res, (err?: unknown) => {
        if (err) return reject(err)
        resolve()
        second()
      })
    })
  }) as RequestHandler
}

/**
 * Hold a multipart body to `limit` bytes while multer reads it: by
 * Content-Length up front, and counted as it streams for a body that doesn't
 * declare one. multer has a per-file and per-field size but no total, so
 * without this a request could carry any number of fields.
 */
function capBody(mw: RequestHandler, limit: number): RequestHandler {
  return (req, res, next) => {
    if (Number(req.headers['content-length']) > limit) return next(tooLarge(limit))
    if (typeof req.pipe !== 'function') return mw(req, res, next)
    const pipe = req.pipe.bind(req)
    // multer reads the request with `req.pipe(busboy)`; count what passes.
    req.pipe = (<T extends NodeJS.WritableStream>(destination: T): T => {
      let received = 0
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          received += chunk.length
          if (received <= limit) return done(null, chunk)
          // busboy's error reaches multer, which hands it to `next`.
          if (received - chunk.length <= limit) {
            ;(destination as unknown as Writable).destroy(tooLarge(limit))
          }
          done()
        },
      })
      pipe(counter)
      return counter.pipe(destination)
    }) as typeof req.pipe
    mw(req, res, next)
  }
}

function single(fieldName: string, options: UploadOptions = {}): RequestHandler {
  const m = createMulter(options)
  const { total } = uploadLimits({ mode: 'single', maxSize: options.maxSize })
  return bothConventions(
    capBody(
      translateMulterErrors(m.single(fieldName), options, { field: fieldName, max: 1 }),
      total,
    ),
  )
}

/**
 * Multiple file upload middleware. Attaches files to `req.files`.
 */
function array(fieldName: string, maxCount = 10, options: UploadOptions = {}): RequestHandler {
  const m = createMulter(options)
  const { total } = uploadLimits({ mode: 'array', maxSize: options.maxSize, maxCount })
  return bothConventions(
    capBody(
      translateMulterErrors(m.array(fieldName, maxCount), options, {
        field: fieldName,
        max: maxCount,
      }),
      total,
    ),
  )
}

/**
 * No file upload — just parse multipart form data without file fields.
 */
function none(options: UploadOptions = {}): RequestHandler {
  const m = createMulter(options)
  const { total } = uploadLimits({ mode: 'none' })
  return bothConventions(capBody(translateMulterErrors(m.none(), options), total))
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
  if (config.rename) options.rename = config.rename

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
