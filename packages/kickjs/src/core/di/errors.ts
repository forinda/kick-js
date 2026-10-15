/**
 * The container's own errors, by stable code. A host can replace the factory
 * (`Container._error`) to turn them into richer errors — kickjs maps each
 * code to its catalogue entry, with the cause and the fix.
 */
export type DiErrorCode =
  /** Nothing is registered for the token. */
  | 'KICK001'
  /** A REQUEST-scoped token, but no request store is installed. */
  | 'KICK002'
  /** A REQUEST-scoped token, resolved outside a request. */
  | 'KICK003'
  /** `@Value` key not set, and no default. */
  | 'KICK004'

export class DiError extends Error {
  constructor(
    readonly code: DiErrorCode,
    /** The token name, or the env key for KICK004. */
    readonly subject: string,
    message: string,
  ) {
    super(message)
    this.name = 'DiError'
  }
}

const MESSAGES: Record<DiErrorCode, (subject: string) => string> = {
  KICK001: (s) => `No provider for ${s}`,
  KICK002: (s) => `Cannot resolve REQUEST-scoped "${s}": no request store is installed`,
  KICK003: (s) => `Cannot resolve REQUEST-scoped "${s}" outside a request`,
  KICK004: (s) => `@Value('${s}'): not set and no default provided`,
}

export function diError(code: DiErrorCode, subject: string): Error {
  return new DiError(code, subject, `${code}: ${MESSAGES[code](subject)}`)
}

/** Where the container reports non-fatal problems. Silent unless a host installs one. */
export interface DiLogger {
  warn(message: string): void
  error(err: unknown, message: string): void
}

export const silentLogger: DiLogger = { warn() {}, error() {} }
