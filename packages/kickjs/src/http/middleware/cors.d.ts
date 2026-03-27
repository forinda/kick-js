import type { Request, Response, NextFunction } from 'express'
export interface CorsOptions {
  /** Allowed origin(s). `true` reflects request origin, `'*'` allows all, string/regex/array for allowlist. Default: `'*'` */
  origin?: boolean | string | RegExp | (string | RegExp)[]
  /** Allowed HTTP methods. Default: `['GET','HEAD','PUT','PATCH','POST','DELETE']` */
  methods?: string[]
  /** Allowed request headers. Default: reflects `Access-Control-Request-Headers` */
  allowedHeaders?: string[]
  /** Headers exposed to the browser. Default: none */
  exposedHeaders?: string[]
  /** Allow credentials (cookies, authorization). Default: false */
  credentials?: boolean
  /** Preflight cache duration in seconds. Default: 86400 (24h) */
  maxAge?: number
  /** Handle preflight OPTIONS requests. Default: true */
  preflight?: boolean
}
/**
 * CORS middleware with correct spec behavior.
 *
 * - Reflects origin from allowlist (sets `Vary: Origin`)
 * - Handles preflight `OPTIONS` with `204 No Content`
 * - Supports string, regex, and array origin matching
 *
 * @example
 * ```ts
 * // Allow all origins
 * bootstrap({ middleware: [cors(), express.json()] })
 *
 * // Allowlist specific origins
 * bootstrap({
 *   middleware: [
 *     cors({
 *       origin: ['https://app.example.com', /\.example\.com$/],
 *       credentials: true,
 *     }),
 *     express.json(),
 *   ],
 * })
 * ```
 */
export declare function cors(
  options?: CorsOptions,
): (req: Request, res: Response, next: NextFunction) => void
//# sourceMappingURL=cors.d.ts.map
