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
}
