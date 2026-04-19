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

/** Validation error detail — shape used by `unprocessable()` and `fromZodError()`. */
export interface ValidationError {
  field: string
  message: string
  code?: string
}

/**
 * Typed HTTP exception with status code, free-form details, and optional
 * response headers. Provides static factory methods for common HTTP errors.
 *
 * `details` is intentionally typed as `unknown` — it serializes straight into
 * the response body's `errors` field, so any JSON-compatible shape works
 * (string, object, array of mixed values, ValidationError[]).
 *
 * `headers` are merged into the response by the global error handler so
 * spec-mandated headers (Retry-After, WWW-Authenticate, Allow, Location)
 * stay on the exception, not on ad-hoc try/catch chains.
 */
export class HttpException extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
    public readonly headers?: Record<string, string>,
  ) {
    super(message)
    this.name = 'HttpException'
  }

  /** Return a new exception with `headers` shallow-merged onto this one. */
  withHeaders(headers: Record<string, string>): HttpException {
    return new HttpException(this.status, this.message, this.details, {
      ...this.headers,
      ...headers,
    })
  }

  /** Create from a Zod error */
  static fromZodError(error: any, message?: string): HttpException {
    const firstIssue = error.issues?.[0]
    const details: ValidationError[] = (error.issues || []).map((issue: any) => ({
      field: issue.path?.join('.') || '',
      message: issue.message,
      code: issue.code,
    }))
    return new HttpException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      message || firstIssue?.message || 'Validation failed',
      details,
    )
  }

  static badRequest(message = 'Bad Request') {
    return new HttpException(HttpStatus.BAD_REQUEST, message)
  }
  static unauthorized(message = 'Unauthorized', wwwAuthenticate?: string) {
    return new HttpException(
      HttpStatus.UNAUTHORIZED,
      message,
      undefined,
      wwwAuthenticate ? { 'WWW-Authenticate': wwwAuthenticate } : undefined,
    )
  }
  static forbidden(message = 'Forbidden') {
    return new HttpException(HttpStatus.FORBIDDEN, message)
  }
  static notFound(message = 'Not Found') {
    return new HttpException(HttpStatus.NOT_FOUND, message)
  }
  static methodNotAllowed(allowedMethods: string[], message = 'Method Not Allowed') {
    return new HttpException(HttpStatus.METHOD_NOT_ALLOWED, message, undefined, {
      Allow: allowedMethods.join(', '),
    })
  }
  static conflict(message = 'Conflict') {
    return new HttpException(HttpStatus.CONFLICT, message)
  }
  static unprocessable(message = 'Unprocessable Entity', details?: ValidationError[]) {
    return new HttpException(HttpStatus.UNPROCESSABLE_ENTITY, message, details)
  }
  static tooManyRequests(message = 'Too Many Requests', retryAfterSeconds?: number) {
    return new HttpException(
      HttpStatus.TOO_MANY_REQUESTS,
      message,
      undefined,
      retryAfterSeconds !== undefined ? { 'Retry-After': String(retryAfterSeconds) } : undefined,
    )
  }
  static serviceUnavailable(message = 'Service Unavailable', retryAfterSeconds?: number) {
    return new HttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      message,
      undefined,
      retryAfterSeconds !== undefined ? { 'Retry-After': String(retryAfterSeconds) } : undefined,
    )
  }
  static internal(message = 'Internal Server Error') {
    return new HttpException(HttpStatus.INTERNAL_SERVER_ERROR, message)
  }
}
