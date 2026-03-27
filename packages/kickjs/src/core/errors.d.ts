/**
 * Standard HTTP status codes as a const enum.
 * Use instead of raw numbers for readability and type safety.
 *
 * @example
 * ```ts
 * throw new HttpException(HttpStatus.NOT_FOUND, 'User not found')
 * ctx.res.status(HttpStatus.CREATED).json(data)
 * ```
 */
export declare const HttpStatus: {
  readonly OK: 200
  readonly CREATED: 201
  readonly ACCEPTED: 202
  readonly NO_CONTENT: 204
  readonly MOVED_PERMANENTLY: 301
  readonly FOUND: 302
  readonly NOT_MODIFIED: 304
  readonly TEMPORARY_REDIRECT: 307
  readonly PERMANENT_REDIRECT: 308
  readonly BAD_REQUEST: 400
  readonly UNAUTHORIZED: 401
  readonly PAYMENT_REQUIRED: 402
  readonly FORBIDDEN: 403
  readonly NOT_FOUND: 404
  readonly METHOD_NOT_ALLOWED: 405
  readonly NOT_ACCEPTABLE: 406
  readonly CONFLICT: 409
  readonly GONE: 410
  readonly UNPROCESSABLE_ENTITY: 422
  readonly TOO_MANY_REQUESTS: 429
  readonly INTERNAL_SERVER_ERROR: 500
  readonly NOT_IMPLEMENTED: 501
  readonly BAD_GATEWAY: 502
  readonly SERVICE_UNAVAILABLE: 503
  readonly GATEWAY_TIMEOUT: 504
}
export type HttpStatusCode = (typeof HttpStatus)[keyof typeof HttpStatus]
/** Validation error detail */
export interface ValidationError {
  field: string
  message: string
  code?: string
}
/**
 * Typed HTTP exception with status code and optional validation details.
 * Provides static factory methods for common HTTP errors.
 */
export declare class HttpException extends Error {
  readonly status: number
  readonly details?: ValidationError[] | undefined
  constructor(status: number, message: string, details?: ValidationError[] | undefined)
  /** Create from a Zod error */
  static fromZodError(error: any, message?: string): HttpException
  static badRequest(message?: string): HttpException
  static unauthorized(message?: string): HttpException
  static forbidden(message?: string): HttpException
  static notFound(message?: string): HttpException
  static conflict(message?: string): HttpException
  static unprocessable(message?: string, details?: ValidationError[]): HttpException
  static tooManyRequests(message?: string): HttpException
  static internal(message?: string): HttpException
}
//# sourceMappingURL=errors.d.ts.map
