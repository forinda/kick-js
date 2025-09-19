export interface AppErrorOptions {
  status?: number;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.code = code;
    this.status = options.status;
    this.details = options.details;

    if (options.cause) {
      // @ts-expect-error cause is standard on Error but not typed in older TS libs
      this.cause = options.cause;
    }

    this.name = 'AppError';
  }
}

export function createError(code: string, message: string, options: AppErrorOptions = {}) {
  return new AppError(code, message, options);
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
