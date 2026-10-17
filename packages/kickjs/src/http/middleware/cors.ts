import type {
  ConnectRequest as Request,
  ConnectResponse as Response,
  ConnectNext as NextFunction,
} from '../connect'

export interface CorsOptions {
  /** Allowed origin(s). `true` reflects request origin, `'*'` allows all, `false` rejects all. Default: `false` (restrictive) */
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

const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']

function isOriginAllowed(requestOrigin: string, allowed: CorsOptions['origin']): boolean {
  if (allowed === true || allowed === '*') return true
  if (typeof allowed === 'string') return requestOrigin === allowed
  if (allowed instanceof RegExp) return allowed.test(requestOrigin)
  if (Array.isArray(allowed)) {
    return allowed.some((pattern) =>
      typeof pattern === 'string' ? requestOrigin === pattern : pattern.test(requestOrigin),
    )
  }
  return false
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
 * bootstrap({ middlewares: [cors(), express.json()] })
 *
 * // Allowlist specific origins
 * bootstrap({
 *   middlewares: [
 *     cors({
 *       origin: ['https://app.example.com', /\.example\.com$/],
 *       credentials: true,
 *     }),
 *     express.json(),
 *   ],
 * })
 * ```
 *
 * Options are read once, when the middleware is created: changing the options
 * object afterwards does not change the headers. Create a new middleware instead.
 */
export function cors(options: CorsOptions = {}) {
  const {
    origin = false,
    methods = DEFAULT_METHODS,
    allowedHeaders,
    exposedHeaders,
    credentials = false,
    maxAge = 86400,
    preflight = true,
  } = options

  // Header values depend only on the options — joined once, not per request.
  const exposeValue = exposedHeaders?.length ? exposedHeaders.join(', ') : undefined
  const methodsValue = methods.join(', ')
  const allowedValue = allowedHeaders?.join(', ')
  const maxAgeValue = maxAge ? String(maxAge) : undefined

  return (req: Request, res: Response, next: NextFunction) => {
    const requestOrigin = req.headers.origin

    // Determine the Access-Control-Allow-Origin value
    if (origin === '*' && !credentials) {
      res.setHeader('Access-Control-Allow-Origin', '*')
    } else if (requestOrigin) {
      if (isOriginAllowed(requestOrigin, origin)) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin)
        // Must vary by Origin when reflecting — CDN/proxy correctness
        res.setHeader('Vary', 'Origin')
      }
    }

    if (credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    if (exposeValue) res.setHeader('Access-Control-Expose-Headers', exposeValue)

    // Preflight handling
    if (preflight && req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', methodsValue)

      const reqHeaders = allowedValue ?? req.headers['access-control-request-headers']
      if (reqHeaders) {
        const value = Array.isArray(reqHeaders) ? reqHeaders.join(', ') : reqHeaders
        res.setHeader('Access-Control-Allow-Headers', value)
      }

      if (maxAgeValue) res.setHeader('Access-Control-Max-Age', maxAgeValue)

      res.statusCode = 204
      res.setHeader('Content-Length', '0')
      res.end()
      return
    }

    next()
  }
}
