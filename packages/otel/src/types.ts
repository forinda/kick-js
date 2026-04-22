export interface OtelAdapterOptions {
  /** Service name reported to the OTel backend (default: 'kickjs-app') */
  serviceName?: string

  /** Service version (default: '0.0.0') */
  serviceVersion?: string

  /** Enable HTTP request tracing (default: true) */
  tracing?: boolean

  /** Enable request metrics — counter, histogram (default: true) */
  metrics?: boolean

  /**
   * Custom span attributes added to every request span.
   * Receives the Express request object.
   */
  customAttributes?: (req: any) => Record<string, string | number | boolean>

  /**
   * Routes to ignore from tracing (e.g., health checks).
   * Supports exact match or prefix match with trailing *.
   * @example ['/health', '/_debug/*', '/favicon.ico']
   */
  ignoreRoutes?: string[]

  /**
   * Span-attribute keys to mask before export. Mirrors pino's
   * `redact.paths` contract so one list can drive both log and span
   * redaction:
   *
   * ```ts
   * import { sensitiveKeys } from './config/redaction'
   *
   * pino({ redact: { paths: sensitiveKeys } })
   * OtelAdapter({ sensitiveKeys })
   * ```
   *
   * String entries do case-insensitive exact match on the attribute
   * key (not value); `RegExp` entries are matched against the key.
   * Matching attributes have their value replaced with `'[REDACTED]'`.
   *
   * @example
   * ```ts
   * sensitiveKeys: ['password', 'token', /^x-api-key/i, /authorization/i]
   * ```
   */
  sensitiveKeys?: (string | RegExp)[]

  /**
   * Custom redactor — takes precedence over `sensitiveKeys` when set.
   * Return the replacement value (`'[REDACTED]'` by convention) or the
   * original value to let it through.
   */
  redactAttribute?: (key: string, value: unknown) => unknown
}
