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
export const HttpStatus = {
  // 2xx Success
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,

  // 3xx Redirection
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  NOT_MODIFIED: 304,
  TEMPORARY_REDIRECT: 307,
  PERMANENT_REDIRECT: 308,

  // 4xx Client Errors
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  CONFLICT: 409,
  GONE: 410,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,

  // 5xx Server Errors
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const

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
export class HttpException extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: ValidationError[],
  ) {
    super(message)
    this.name = 'HttpException'
  }

  /** Create from a Zod error */
  static fromZodError(error: any, message?: string): HttpException {
    const firstIssue = error.issues?.[0]
    return new HttpException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      message || firstIssue?.message || 'Validation failed',
      [
        ...(error.issues || []).map((issue: any) => ({
          field: issue.path?.join('.') || '',
          message: issue.message,
          code: issue.code,
        })),
      ],
    )
  }

  static badRequest(message = 'Bad Request') {
    return new HttpException(HttpStatus.BAD_REQUEST, message)
  }
  static unauthorized(message = 'Unauthorized') {
    return new HttpException(HttpStatus.UNAUTHORIZED, message)
  }
  static forbidden(message = 'Forbidden') {
    return new HttpException(HttpStatus.FORBIDDEN, message)
  }
  static notFound(message = 'Not Found') {
    return new HttpException(HttpStatus.NOT_FOUND, message)
  }
  static conflict(message = 'Conflict') {
    return new HttpException(HttpStatus.CONFLICT, message)
  }
  static unprocessable(message = 'Unprocessable Entity', details?: ValidationError[]) {
    return new HttpException(HttpStatus.UNPROCESSABLE_ENTITY, message, details)
  }
  static tooManyRequests(message = 'Too Many Requests') {
    return new HttpException(HttpStatus.TOO_MANY_REQUESTS, message)
  }
  static internal(message = 'Internal Server Error') {
    return new HttpException(HttpStatus.INTERNAL_SERVER_ERROR, message)
  }
}
