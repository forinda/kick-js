import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, join, sep, dirname, isAbsolute, relative } from 'node:path'
import { Logger, defineAdapter } from '../../core'
import type { ConnectMiddleware } from '../runtime'

const log = Logger.for('SpaAdapter')

export interface SpaAdapterOptions {
  /**
   * Directory containing the built SPA files (index.html, assets, etc.)
   * Default: 'dist/client'
   *
   * @example
   * ```ts
   * // Vue: 'dist'
   * // React (Vite): 'dist'
   * // React (CRA): 'build'
   * // Svelte: 'build'
   * // Angular: 'dist/my-app/browser'
   * ```
   */
  clientDir?: string

  /**
   * URL prefix for API routes. SPA fallback only applies to
   * non-API routes (routes NOT starting with this prefix).
   * Default: '/api'
   *
   * Matching is segment-aware: `/api` excludes `/api` and `/api/users`, but
   * NOT `/apidocs` — a plain `startsWith` swallowed any path that merely
   * began with the same letters.
   *
   * Set to an array for multiple prefixes:
   * ```ts
   * apiPrefix: ['/api', '/graphql', '/_debug']
   * ```
   */
  apiPrefix?: string | string[]

  /**
   * Additional paths to exclude from SPA fallback.
   * These paths will NOT serve index.html. Segment-aware, like `apiPrefix`.
   *
   * @example
   * ```ts
   * exclude: ['/health', '/metrics', '/ws']
   * ```
   */
  exclude?: string[]

  /**
   * Cache-Control header for static assets (default: 'public, max-age=31536000, immutable')
   * Set to false to disable caching headers.
   */
  cacheControl?: string | false

  /**
   * Cache-Control for index.html (default: 'no-cache')
   * index.html should not be cached to ensure clients get fresh builds.
   */
  indexCacheControl?: string

  /**
   * Serve index.html even when the client did not ask for HTML.
   * Default: false.
   *
   * By default the fallback only fires for requests whose `Accept` header
   * includes `text/html` — the rule `connect-history-api-fallback` uses. That
   * keeps a missing `/assets/app.js` a 404 instead of handing back an HTML
   * document that the browser then fails to parse as JavaScript, which is a
   * confusing way to discover a broken build.
   *
   * Turn this on if you have non-browser clients that deep-link into SPA
   * routes without an `Accept` header.
   */
  alwaysFallback?: boolean
}

/**
 * Nearest directory at or above `from` that holds a `package.json`.
 * `null` when the walk reaches the filesystem root without finding one.
 */
function nearestPackageRoot(from: string): string | null {
  let dir = from
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Where to look for the built SPA.
 *
 * `process.cwd()` is the framework's convention (assets and env files resolve
 * the same way) and stays the primary base. But a relative `clientDir` then
 * only works when the process happens to be started from the app directory —
 * `node server/dist/index.js` run from a monorepo root resolved `../web/dist`
 * against the root and found nothing, serving no SPA with only a warning.
 *
 * So: try cwd first, and only if that misses, retry against the package root
 * of the entry script. Both are checked for existence before being chosen, so
 * this can never silently pick a directory that is not there — a genuinely
 * missing build still lands on the cwd path, which is what the warning names.
 *
 * Deliberately not entry-relative FIRST: under `kick dev` the entry is the CLI
 * binary, whose package root is the CLI itself.
 *
 * Exported for tests only — not re-exported from the package index.
 */
export function resolveClientDir(
  clientDir: string,
  // Injected rather than read from the process so tests can exercise the
  // monorepo-root case without `process.chdir` / `process.argv` mutation —
  // neither is supported under vitest's `threads` pool, and the root config
  // uses exactly that.
  cwd: string = process.cwd(),
  entry: string | undefined = process.argv[1],
): string {
  // `resolve` even for an already-absolute path: `resolvesToFile` compares its
  // (always normalized) target against this string, so a trailing slash or a
  // `.`/`..` segment here would make the containment check never match and
  // silently drop the Cache-Control header on every request. Fails closed, so
  // it never weakened the traversal guard — it just stopped doing its job.
  if (isAbsolute(clientDir)) return resolve(clientDir)
  const fromCwd = resolve(cwd, clientDir)
  if (existsSync(fromCwd)) return fromCwd

  if (entry) {
    const root = nearestPackageRoot(dirname(resolve(entry)))
    if (root) {
      const fromEntry = resolve(root, clientDir)
      if (existsSync(fromEntry)) return fromEntry
    }
  }
  return fromCwd
}

/**
 * The slice of the request/response this adapter touches, spelled from the
 * node `http` shapes rather than Express's. `ConnectMiddleware` is typed as
 * Express's `RequestHandler`, but under Fastify and h3 these handlers receive
 * the raw node objects (or a driver), so relying on `req.path` / `res.send`
 * is what made the previous version Express-only.
 */
interface SpaRequest {
  url?: string
  method?: string
  headers?: Record<string, string | string[] | undefined>
}

interface SpaResponse {
  setHeader(name: string, value: string): void
  statusCode: number
  end(chunk?: string): void
}

type SpaHandler = (req: SpaRequest, res: SpaResponse, next: () => void) => void

/** Pathname only — `req.url` carries the query string, and `req.path` is Express-only. */
function pathnameOf(url: string | undefined): string {
  if (!url) return '/'
  const q = url.indexOf('?')
  const h = url.indexOf('#')
  const end = Math.min(q === -1 ? url.length : q, h === -1 ? url.length : h)
  return url.slice(0, end) || '/'
}

/**
 * Segment-aware prefix test: `/api` covers `/api` and `/api/users`, not
 * `/apidocs`. `startsWith` alone made any same-prefixed route disappear from
 * the SPA fallback and 404 instead.
 */
function isUnder(pathname: string, prefix: string): boolean {
  if (!prefix || prefix === '/') return true
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  return pathname === p || pathname.startsWith(`${p}/`)
}

/** Media ranges that count as "the client wants a document". */
const HTML_TYPES = ['text/html', 'application/xhtml+xml']

/** `q` for a media range, defaulting to 1 when absent or unparseable. */
function qualityOf(params: string[]): number {
  const q = params.find((param) => param.startsWith('q='))
  if (!q) return 1
  const value = Number.parseFloat(q.slice(2))
  return Number.isNaN(value) ? 1 : value
}

/**
 * Does the client want an HTML document back?
 *
 * Parses media ranges with q-values rather than substring-matching:
 * `Accept: text/html;q=0` explicitly says HTML is NOT acceptable (RFC 9110
 * §12.5.1 — "a value of 0 means not acceptable"), and a substring check read
 * that as a yes and returned the document anyway.
 *
 * Wildcards are matched by specificity, as RFC 9110 §12.5.1 requires: an exact
 * `text/html` beats `text/*`, so `Accept: text/*, text/html;q=0` correctly
 * rejects HTML even though the wildcard would have accepted it.
 *
 * A bare `*` / `*` deliberately does NOT count, at any q. Assets are fetched
 * with `Accept: * / *`, and treating that as a document request is what makes
 * a missing script come back as HTML — the very thing the fallback rules
 * exist to prevent.
 */
function acceptsHtml(accept: string | string[] | undefined): boolean {
  const raw = Array.isArray(accept) ? accept.join(',') : (accept ?? '')
  if (!raw) return false

  const ranges = raw
    .split(',')
    .map((part) => part.split(';').map((t) => t.trim().toLowerCase()))
    .filter(([type]) => Boolean(type))

  return HTML_TYPES.some((htmlType) => {
    const [group] = htmlType.split('/')
    // Most specific match wins: exact type, else `type/*`. `*/*` is skipped.
    const exact = ranges.find(([type]) => type === htmlType)
    const wildcard = ranges.find(([type]) => type === `${group}/*`)
    const match = exact ?? wildcard
    return match ? qualityOf(match.slice(1)) > 0 : false
  })
}

/**
 * SPA adapter — serve a Vue, React, Svelte, or Angular build alongside
 * your KickJS API. API routes are handled by controllers; everything else
 * falls back to index.html for client-side routing.
 *
 * Written against the engine-agnostic `http` surface (`serveStatic` / `use`),
 * so it runs under Express, Fastify, and h3 alike. The previous version
 * reached for `express.static`, `req.path`, and `res.send`, all of which are
 * Express-only — it silently served nothing on the other runtimes.
 *
 * Migrated to the `defineAdapter()` factory — call without `new`, as
 * `ViewAdapter` has since v4.
 *
 * @example
 * ```ts
 * import { SpaAdapter } from '@forinda/kickjs/spa'
 *
 * bootstrap({
 *   modules,
 *   adapters: [
 *     SpaAdapter({
 *       clientDir: 'dist/client',  // or 'build', 'dist', etc.
 *       apiPrefix: '/api',
 *     }),
 *   ],
 * })
 * ```
 *
 * File structure:
 * ```
 * dist/
 *   client/           ← SPA build output
 *     index.html
 *     assets/
 *       app.js
 *       style.css
 *   server/            ← KickJS server
 * ```
 */
export const SpaAdapter = defineAdapter<SpaAdapterOptions>({
  name: 'SpaAdapter',
  defaults: {
    clientDir: 'dist/client',
    apiPrefix: '/api',
    exclude: [],
    cacheControl: 'public, max-age=31536000, immutable',
    indexCacheControl: 'no-cache',
    alwaysFallback: false,
  },
  build: (config) => {
    const clientDir = resolveClientDir(config.clientDir ?? 'dist/client')
    const rawPrefix = config.apiPrefix ?? '/api'
    const apiPrefixes = Array.isArray(rawPrefix) ? rawPrefix : [rawPrefix]
    const excludePaths = config.exclude ?? []
    const cacheControl = config.cacheControl ?? 'public, max-age=31536000, immutable'
    const indexCacheControl = config.indexCacheControl ?? 'no-cache'
    const alwaysFallback = config.alwaysFallback ?? false

    let indexHtml: string | null = null

    /**
     * Every file in the build, as request paths (`/assets/app.js`), captured
     * once at mount.
     *
     * This used to be a `statSync` per request. That is a synchronous
     * filesystem call on the hot path of every non-reserved request, and a
     * slow or contended disk blocks the event loop for unrelated requests.
     * The directory is a static build — its contents are already snapshotted
     * at boot, since `index.html` is read into memory there — so the lookup
     * belongs in memory too. No filesystem access remains in the request path.
     *
     * A build added to after boot is not picked up, which is the same
     * contract `index.html` already had.
     */
    let assetPaths: ReadonlySet<string> = new Set()

    function snapshotClientDir(): ReadonlySet<string> {
      try {
        const entries = readdirSync(clientDir, { recursive: true, withFileTypes: true })
        const paths = new Set<string>()
        for (const entry of entries) {
          if (!entry.isFile()) continue
          // `parentPath` is absolute; make it a request path.
          const abs = join(entry.parentPath, entry.name)
          paths.add(`/${relative(clientDir, abs).split(sep).join('/')}`)
        }
        return paths
      } catch {
        return new Set()
      }
    }

    /**
     * How the static layer will answer this path: as the index document, as a
     * long-lived asset, or not at all.
     *
     * Membership of the snapshot IS the containment guard — a traversal like
     * `/../../etc/passwd` simply is not a key — so no prefix comparison is
     * needed and the whole check is one `Set.has`.
     */
    const classifyPath = (pathname: string): 'file' | 'index' | null => {
      let decoded: string
      try {
        decoded = decodeURIComponent(pathname)
      } catch {
        return null
      }
      if (decoded.includes('\0')) return null

      // A directory is served from its `index.html`, so `/` — the single most
      // common request — is an index request, not an asset. Reporting it as
      // neither left the root document without the configured policy.
      const asIndex = decoded.endsWith('/') ? `${decoded}index.html` : null
      if (asIndex && assetPaths.has(asIndex)) return 'index'
      if (!assetPaths.has(decoded)) return null
      return decoded.endsWith('.html') ? 'index' : 'file'
    }

    /** Skipped by the fallback: API routes, opted-out paths. */
    const isReserved = (pathname: string): boolean =>
      apiPrefixes.some((p) => isUnder(pathname, p)) ||
      excludePaths.some((p) => isUnder(pathname, p))

    return {
      beforeMount({ http }) {
        if (!existsSync(clientDir)) {
          log.warn(`SPA client directory not found: ${clientDir}`)
          log.warn(
            `Build your frontend first, or set clientDir to the correct path ` +
              `(relative paths resolve from ${process.cwd()}).`,
          )
          return
        }

        const indexPath = join(clientDir, 'index.html')
        if (!existsSync(indexPath)) {
          log.warn(`index.html not found in ${clientDir}`)
          return
        }
        indexHtml = readFileSync(indexPath, 'utf-8')
        assetPaths = snapshotClientDir()

        // Cache-Control runs as its own middleware ahead of the static
        // handler: the engine-agnostic `serveStatic` takes no header hook,
        // and headers set before the static layer writes still land on the
        // response. Keyed off the request path rather than the resolved file,
        // which is the same decision `express.static`'s `setHeaders` made.
        if (cacheControl !== false) {
          http.use(((req, res, next) => {
            const pathname = pathnameOf(req.url)
            // Only label a response the static layer will actually serve.
            // `express.static`'s `setHeaders` fired on hits only; running as
            // a separate middleware loses that, and an unconditional header
            // put `immutable, max-age=31536000` on the 404 for a missing
            // asset — telling every cache to keep that miss for a year.
            const kind = isReserved(pathname) ? null : classifyPath(pathname)
            if (kind) {
              res.setHeader('Cache-Control', kind === 'index' ? indexCacheControl : cacheControl)
            }
            next()
          }) satisfies SpaHandler as unknown as ConnectMiddleware)
        }

        http.serveStatic('/', clientDir)
        log.debug(`Serving SPA from ${clientDir}`)
      },

      beforeStart({ http }) {
        if (!indexHtml) return

        http.use(((req, res, next) => {
          // GET and HEAD both navigate. HEAD used to fall through to a 404,
          // which broke proxies and link checkers probing SPA routes.
          const method = (req.method ?? 'GET').toUpperCase()
          if (method !== 'GET' && method !== 'HEAD') return next()

          const pathname = pathnameOf(req.url)
          if (isReserved(pathname)) return next()

          // Content negotiation instead of a "does the path contain a dot"
          // guess. The old heuristic 404'd every legitimate route carrying a
          // dot (`/users/john.doe`, `/v1.2/spec`) while still handing HTML to
          // genuinely missing assets whose path had no extension.
          const accept = req.headers?.['accept'] as string | string[] | undefined
          if (!alwaysFallback && !acceptsHtml(accept)) return next()

          const body = indexHtml as string
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.setHeader('Cache-Control', indexCacheControl)
          res.setHeader('Content-Length', String(Buffer.byteLength(body)))
          res.statusCode = 200
          // HEAD must carry identical headers and no body.
          res.end(method === 'HEAD' ? undefined : body)
        }) satisfies SpaHandler as unknown as ConnectMiddleware)
      },
    }
  },
})
