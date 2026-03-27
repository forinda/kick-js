import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { type Options as MulterOptions } from 'multer';
import type { BaseUploadOptions, FileUploadConfig } from '../../core';
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
export declare function resolveMimeTypes(types: string[]): string[];
/**
 * Upload options for the middleware.
 * Extends BaseUploadOptions from core (shared with @FileUpload decorator)
 * and adds Multer-specific storage options.
 */
export interface UploadOptions extends BaseUploadOptions {
    /** Multer storage config (default: memory storage) */
    storage?: MulterOptions['storage'];
    /** Multer dest for disk storage shorthand */
    dest?: string;
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
declare function single(fieldName: string, options?: UploadOptions): RequestHandler;
/**
 * Multiple file upload middleware. Attaches files to `req.files`.
 */
declare function array(fieldName: string, maxCount?: number, options?: UploadOptions): RequestHandler;
/**
 * No file upload — just parse multipart form data without file fields.
 */
declare function none(options?: UploadOptions): RequestHandler;
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
export declare function cleanupFiles(): (req: Request, res: Response, next: NextFunction) => void;
/**
 * Build upload middleware from a @FileUpload decorator config.
 * Used internally by the router builder when it detects FILE_UPLOAD metadata.
 * Accepts the same FileUploadConfig interface used by the @FileUpload decorator.
 */
export declare function buildUploadMiddleware(config: FileUploadConfig): RequestHandler;
/** Upload middleware factory with `.single()`, `.array()`, `.none()` methods */
export declare const upload: {
    single: typeof single;
    array: typeof array;
    none: typeof none;
};
export {};
//# sourceMappingURL=upload.d.ts.map