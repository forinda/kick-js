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
    return new HttpException(422, message || firstIssue?.message || 'Validation failed', [
      ...(error.issues || []).map((issue: any) => ({
        field: issue.path?.join('.') || '',
        message: issue.message,
        code: issue.code,
      })),
    ])
  }

  static badRequest(message = 'Bad Request') {
    return new HttpException(400, message)
  }
  static unauthorized(message = 'Unauthorized') {
    return new HttpException(401, message)
  }
  static forbidden(message = 'Forbidden') {
    return new HttpException(403, message)
  }
  static notFound(message = 'Not Found') {
    return new HttpException(404, message)
  }
  static conflict(message = 'Conflict') {
    return new HttpException(409, message)
  }
  static unprocessable(message = 'Unprocessable Entity', details?: ValidationError[]) {
    return new HttpException(422, message, details)
  }
  static tooManyRequests(message = 'Too Many Requests') {
    return new HttpException(429, message)
  }
  static internal(message = 'Internal Server Error') {
    return new HttpException(500, message)
  }
}
