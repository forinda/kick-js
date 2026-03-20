import { Controller, Get, Post, FileUpload, Middleware } from '@forinda/kickjs-core'
import { RequestContext, upload } from '@forinda/kickjs-http'

/**
 * Upload controller demonstrating every file upload variant in KickJS.
 *
 * There are two approaches:
 *   1. Declarative: Use the @FileUpload decorator (recommended). The framework
 *      automatically wires up the multer middleware from the metadata.
 *   2. Manual: Use @Middleware with upload.single() / upload.array() / upload.none().
 *      Because @Middleware expects (ctx, next) handlers, you must wrap the raw
 *      Express middleware using a small adapter (see wrapExpressMiddleware below).
 */

// ── Helper: wrap raw Express middleware for use with @Middleware ─────────
// The @Middleware decorator expects (ctx: RequestContext, next) => void,
// but upload.single() etc. return (req, res, next) Express handlers.
function wrapExpressMiddleware(
  handler: (req: any, res: any, next: any) => void,
) {
  return (ctx: RequestContext, next: () => void) => {
    handler(ctx.req, ctx.res, next)
  }
}

@Controller()
export class UploadController {
  // ────────────────────────────────────────────────────────────────────────
  // 1. @FileUpload with string array allowedTypes
  //    Accepts only JPEG and PNG images up to 2 MB.
  //    The framework resolves short extensions ('jpg', 'png') to MIME types.
  // ────────────────────────────────────────────────────────────────────────
  @Post('/single')
  @FileUpload({
    mode: 'single',
    fieldName: 'avatar',
    maxSize: 2 * 1024 * 1024,
    allowedTypes: ['jpg', 'png'],
  })
  async uploadSingle(ctx: RequestContext) {
    const file = ctx.file
    if (!file) {
      return ctx.badRequest('No file uploaded. Use field name "avatar".')
    }
    ctx.json({
      message: 'Single file uploaded (string array filter)',
      file: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // 2. @FileUpload with a filter function for allowedTypes
  //    Full control: accepts images and PDFs only, rejects everything else.
  // ────────────────────────────────────────────────────────────────────────
  @Post('/single-filter')
  @FileUpload({
    mode: 'single',
    fieldName: 'document',
    maxSize: 5 * 1024 * 1024,
    allowedTypes: (mimetype: string, _filename: string) => {
      // Accept any image or PDF
      return mimetype.startsWith('image/') || mimetype === 'application/pdf'
    },
  })
  async uploadSingleFilter(ctx: RequestContext) {
    const file = ctx.file
    if (!file) {
      return ctx.badRequest('No file uploaded. Use field name "document".')
    }
    ctx.json({
      message: 'Single file uploaded (filter function)',
      file: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // 3. @FileUpload in array mode
  //    Accepts up to 5 image files at once via the "photos" field.
  // ────────────────────────────────────────────────────────────────────────
  @Post('/multiple')
  @FileUpload({
    mode: 'array',
    fieldName: 'photos',
    maxCount: 5,
    maxSize: 10 * 1024 * 1024,
    allowedTypes: ['image/*'],
  })
  async uploadMultiple(ctx: RequestContext) {
    const files = ctx.files
    if (!files || files.length === 0) {
      return ctx.badRequest('No files uploaded. Use field name "photos".')
    }
    ctx.json({
      message: `${files.length} file(s) uploaded`,
      files: files.map((f: any) => ({
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
      })),
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // 4. Manual middleware approach: upload.single()
  //    Uses @Middleware with a wrapped Express upload handler.
  //    This gives you full control but is more verbose.
  // ────────────────────────────────────────────────────────────────────────
  @Post('/middleware-single')
  @Middleware(
    wrapExpressMiddleware(
      upload.single('file', {
        maxSize: 3 * 1024 * 1024,
        allowedTypes: ['jpg', 'png', 'gif', 'webp'],
      }),
    ),
  )
  async uploadMiddlewareSingle(ctx: RequestContext) {
    const file = ctx.file
    if (!file) {
      return ctx.badRequest('No file uploaded. Use field name "file".')
    }
    ctx.json({
      message: 'Single file uploaded via @Middleware approach',
      file: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // 5. Manual middleware approach: upload.array()
  //    Accepts up to 3 files via the "attachments" field.
  // ────────────────────────────────────────────────────────────────────────
  @Post('/middleware-array')
  @Middleware(
    wrapExpressMiddleware(
      upload.array('attachments', 3, {
        maxSize: 5 * 1024 * 1024,
      }),
    ),
  )
  async uploadMiddlewareArray(ctx: RequestContext) {
    const files = ctx.files
    if (!files || files.length === 0) {
      return ctx.badRequest(
        'No files uploaded. Use field name "attachments".',
      )
    }
    ctx.json({
      message: `${files.length} file(s) uploaded via @Middleware approach`,
      files: files.map((f: any) => ({
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
      })),
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // 6. @FileUpload with customMimeMap
  //    Extends the built-in MIME map with custom extensions.
  //    Useful for domain-specific file types (.dwg, .sketch, etc.).
  // ────────────────────────────────────────────────────────────────────────
  @Post('/custom-mime')
  @FileUpload({
    mode: 'single',
    fieldName: 'design',
    maxSize: 20 * 1024 * 1024,
    allowedTypes: ['dwg', 'sketch', 'fig'],
    customMimeMap: {
      dwg: 'application/acad',
      sketch: 'application/x-sketch',
      fig: 'application/x-figma',
    },
  })
  async uploadCustomMime(ctx: RequestContext) {
    const file = ctx.file
    if (!file) {
      return ctx.badRequest('No file uploaded. Use field name "design".')
    }
    ctx.json({
      message: 'File uploaded with custom MIME mapping',
      file: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // 7. @FileUpload in none mode
  //    Parses multipart/form-data but rejects any file fields.
  //    Useful for text-only multipart forms (e.g., large text payloads
  //    sent as form data instead of JSON).
  // ────────────────────────────────────────────────────────────────────────
  @Post('/none')
  @FileUpload({
    mode: 'none',
  })
  async uploadNone(ctx: RequestContext) {
    ctx.json({
      message: 'Multipart form parsed (no files accepted)',
      body: ctx.body,
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // 8. GET / — list all available upload endpoints
  // ────────────────────────────────────────────────────────────────────────
  @Get('/')
  async listExamples(ctx: RequestContext) {
    ctx.json({
      message: 'KickJS File Upload Examples',
      endpoints: [
        {
          method: 'POST',
          path: '/api/v1/uploads/single',
          description:
            '@FileUpload with string array allowedTypes (jpg, png)',
          fieldName: 'avatar',
        },
        {
          method: 'POST',
          path: '/api/v1/uploads/single-filter',
          description:
            '@FileUpload with filter function (images + PDF)',
          fieldName: 'document',
        },
        {
          method: 'POST',
          path: '/api/v1/uploads/multiple',
          description: '@FileUpload in array mode (up to 5 images)',
          fieldName: 'photos',
        },
        {
          method: 'POST',
          path: '/api/v1/uploads/middleware-single',
          description: '@Middleware with upload.single() wrapper',
          fieldName: 'file',
        },
        {
          method: 'POST',
          path: '/api/v1/uploads/middleware-array',
          description: '@Middleware with upload.array() wrapper',
          fieldName: 'attachments',
        },
        {
          method: 'POST',
          path: '/api/v1/uploads/custom-mime',
          description:
            '@FileUpload with customMimeMap (dwg, sketch, fig)',
          fieldName: 'design',
        },
        {
          method: 'POST',
          path: '/api/v1/uploads/none',
          description:
            '@FileUpload in none mode (text-only multipart)',
          fieldName: 'N/A',
        },
      ],
    })
  }
}
