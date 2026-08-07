/**
 * The SPA adapter had no tests at all, despite being public API with its own
 * export path (`@forinda/kickjs/spa`). Three behaviours were broken and none
 * of them were visible:
 *
 *   GET /users/john.doe   404  — any route containing a dot
 *   HEAD /dashboard       404  — HEAD on a SPA route
 *   GET /apidocs          404  — a path merely PREFIXED by `/api`
 *
 * It was also Express-only: `express.static`, `req.path` and `res.send` do
 * not exist under Fastify or h3, so the adapter silently served nothing there
 * while the framework advertises a pluggable runtime.
 *
 * These tests drive the adapter through the engine-agnostic `AdapterHttp`
 * surface with a recording stub, then replay the collected middleware against
 * plain node-shaped request/response objects. That keeps them honest about
 * what the adapter is allowed to touch — anything Express-specific fails here
 * rather than in a consumer's Fastify app.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveClientDir, SpaAdapter, type SpaAdapterOptions } from '../src/http/middleware/spa'

interface RecordedResponse {
  statusCode: number
  headers: Record<string, string>
  body: string | undefined
  ended: boolean
}

type Handler = (req: unknown, res: unknown, next: () => void) => void

/** Minimal `AdapterHttp` that records what the adapter registers. */
function makeHttp() {
  const middleware: Handler[] = []
  const statics: Array<{ prefix: string; dir: string }> = []
  return {
    http: {
      route: () => {},
      mount: () => {},
      serveStatic: (prefix: string, dir: string) => statics.push({ prefix, dir }),
      use: (mw: unknown) => middleware.push(mw as Handler),
    },
    middleware,
    statics,
  }
}

/** Run the recorded chain the way a connect-style runtime would. */
function dispatch(
  middleware: Handler[],
  req: { url: string; method?: string; headers?: Record<string, string> },
): RecordedResponse {
  const res: RecordedResponse = { statusCode: 404, headers: {}, body: undefined, ended: false }
  const target = {
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value
    },
    get statusCode() {
      return res.statusCode
    },
    set statusCode(v: number) {
      res.statusCode = v
    },
    end(chunk?: string) {
      res.body = chunk
      res.ended = true
    },
  }

  let i = 0
  const next = (): void => {
    const mw = middleware[i++]
    if (!mw || res.ended) return
    mw({ headers: {}, method: 'GET', ...req }, target, next)
  }
  next()
  return res
}

/**
 * Dispatch ONLY the cache-header middleware (registered in `beforeMount`),
 * stopping before the SPA fallback.
 *
 * The fallback sets `indexCacheControl` itself on every document it serves, so
 * running the whole chain makes any assertion about the cache layer pass
 * whether or not that layer did anything — which is exactly how the first
 * version of the root-path test came out green with its fix removed. In a real
 * app `/` is answered by the static layer, never reaching the fallback, so the
 * cache middleware is the only thing that can label it.
 */
function dispatchCacheOnly(
  middleware: Handler[],
  req: { url: string; method?: string; headers?: Record<string, string> },
): RecordedResponse {
  return dispatch(middleware.slice(0, 1), req)
}

let dir: string

function buildAdapter(options: SpaAdapterOptions = {}) {
  const adapter = SpaAdapter({ clientDir: dir, ...options })
  const rec = makeHttp()
  const ctx = { http: rec.http } as never
  adapter.beforeMount?.(ctx)
  adapter.beforeStart?.(ctx)
  return { adapter, ...rec }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kick-spa-'))
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>')
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const HTML = { accept: 'text/html,application/xhtml+xml' }

describe('SpaAdapter — declarative factory', () => {
  it('is callable without `new`, like ViewAdapter', () => {
    const adapter = SpaAdapter({ clientDir: dir })
    expect(adapter.name).toBe('SpaAdapter')
    expect(typeof adapter.beforeMount).toBe('function')
  })
})

describe('SpaAdapter — engine-agnostic surface', () => {
  it('serves static through http.serveStatic, not express.static', () => {
    const { statics } = buildAdapter()
    expect(statics).toHaveLength(1)
    expect(statics[0]!.dir).toContain('kick-spa-')
  })

  it('registers its fallback through http.use', () => {
    const { middleware } = buildAdapter()
    expect(middleware.length).toBeGreaterThan(0)
  })

  it('reads the path from req.url — req.path is Express-only', () => {
    // A raw node request has no `.path`. The old adapter read `req.path`, so
    // under Fastify/h3 it saw `undefined` and matched nothing.
    const { middleware } = buildAdapter()
    const res = dispatch(middleware, { url: '/dashboard?a=1', headers: HTML })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<!doctype html>')
  })
})

describe('SpaAdapter — fallback rules', () => {
  it('serves index.html for a plain SPA route', () => {
    const { middleware } = buildAdapter()
    const res = dispatch(middleware, { url: '/dashboard', headers: HTML })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
  })

  it('serves a route containing a dot (was 404)', () => {
    // The old `req.path.includes('.')` guard treated every dotted route as a
    // file request. `/users/john.doe` is a perfectly ordinary SPA route.
    const { middleware } = buildAdapter()
    const res = dispatch(middleware, { url: '/users/john.doe', headers: HTML })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<!doctype html>')
  })

  it('answers HEAD with headers and no body (was 404)', () => {
    const { middleware } = buildAdapter()
    const res = dispatch(middleware, { url: '/dashboard', method: 'HEAD', headers: HTML })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.headers['content-length']).toBeDefined()
    expect(res.body).toBeUndefined()
  })

  it('does not treat /apidocs as an API route (was 404)', () => {
    // `startsWith('/api')` swallowed anything sharing the prefix.
    const { middleware } = buildAdapter({ apiPrefix: '/api' })
    const res = dispatch(middleware, { url: '/apidocs', headers: HTML })
    expect(res.statusCode).toBe(200)
  })

  it('still skips the API prefix itself and its children', () => {
    const { middleware } = buildAdapter({ apiPrefix: '/api' })
    for (const url of ['/api', '/api/users']) {
      expect(dispatch(middleware, { url, headers: HTML }).ended).toBe(false)
    }
  })

  it('skips excluded paths, segment-aware', () => {
    const { middleware } = buildAdapter({ exclude: ['/health'] })
    expect(dispatch(middleware, { url: '/health', headers: HTML }).ended).toBe(false)
    // `/healthy` is a different route and must still reach the SPA.
    expect(dispatch(middleware, { url: '/healthy', headers: HTML }).statusCode).toBe(200)
  })

  it('skips non-GET/HEAD methods', () => {
    const { middleware } = buildAdapter()
    expect(dispatch(middleware, { url: '/dashboard', method: 'POST', headers: HTML }).ended).toBe(
      false,
    )
  })

  it('does not hand HTML to a request that did not ask for it', () => {
    // A missing asset should 404, not receive an HTML document that the
    // browser then fails to parse as JavaScript.
    const { middleware } = buildAdapter()
    const res = dispatch(middleware, { url: '/assets/missing.js', headers: { accept: '*/*' } })
    expect(res.ended).toBe(false)
  })

  it('alwaysFallback opts out of content negotiation', () => {
    const { middleware } = buildAdapter({ alwaysFallback: true })
    const res = dispatch(middleware, { url: '/deep/link', headers: { accept: '*/*' } })
    expect(res.statusCode).toBe(200)
  })
})

describe('SpaAdapter — cache headers', () => {
  it('sets the long-lived header for assets', () => {
    const { middleware } = buildAdapter()
    const res = dispatchCacheOnly(middleware, { url: '/assets/app.js', headers: { accept: '*/*' } })
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('sets no-cache on index.html so clients pick up new builds', () => {
    const { middleware } = buildAdapter()
    expect(
      dispatch(middleware, { url: '/dashboard', headers: HTML }).headers['cache-control'],
    ).toBe('no-cache')
  })

  it('cacheControl:false registers no cache middleware at all', () => {
    const withCache = buildAdapter()
    const without = buildAdapter({ cacheControl: false })
    expect(without.middleware.length).toBe(withCache.middleware.length - 1)
  })
})

describe('SpaAdapter — missing build', () => {
  it('registers nothing when the client dir is absent', () => {
    const adapter = SpaAdapter({ clientDir: join(dir, 'does-not-exist') })
    const rec = makeHttp()
    const ctx = { http: rec.http } as never
    adapter.beforeMount?.(ctx)
    adapter.beforeStart?.(ctx)
    expect(rec.statics).toHaveLength(0)
    expect(rec.middleware).toHaveLength(0)
  })

  it('registers nothing when index.html is missing', () => {
    rmSync(join(dir, 'index.html'))
    const { statics, middleware } = buildAdapter()
    expect(statics).toHaveLength(0)
    expect(middleware).toHaveLength(0)
  })
})

describe('SpaAdapter — cache headers only label real hits', () => {
  it('does not cache a 404 for a missing asset', () => {
    // `express.static`'s `setHeaders` only ran on a hit. Running the header
    // as its own middleware loses that, and an unconditional Cache-Control
    // told every cache to keep a missing asset's 404 for a year.
    const { middleware } = buildAdapter()
    const res = dispatch(middleware, { url: '/assets/missing.js', headers: { accept: '*/*' } })
    expect(res.headers['cache-control']).toBeUndefined()
  })

  it('still caches an asset that exists', () => {
    const { middleware } = buildAdapter()
    const res = dispatch(middleware, { url: '/assets/app.js', headers: { accept: '*/*' } })
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('refuses to stat outside clientDir', () => {
    // The static layer guards itself, but this middleware runs first and
    // must not become the weak link.
    const { middleware } = buildAdapter()
    const res = dispatch(middleware, {
      url: '/../../../../etc/passwd',
      headers: { accept: '*/*' },
    })
    expect(res.headers['cache-control']).toBeUndefined()
  })
})

describe('SpaAdapter — clientDir resolution', () => {
  // Exercised through `resolveClientDir` directly with injected cwd/entry.
  // The earlier version used `process.chdir` + `process.argv[1]`, which
  // throws `process.chdir() is not supported in workers` under the ROOT
  // vitest config (`pool: 'threads'`). It passed under `pnpm test` only
  // because turbo runs each package's own config, which defaults to forks.

  it('finds a relative clientDir from the given cwd', () => {
    expect(resolveClientDir('.', dir)).toBe(dir)
  })

  it('falls back to the entry package root when cwd misses', () => {
    // Reproduces `node server/dist/index.js` launched from a monorepo root:
    // cwd is the root, so `../web/dist` misses there and must be retried
    // against the entry script's own package root.
    const root = mkdtempSync(join(tmpdir(), 'kick-mono-'))
    try {
      const serverDir = join(root, 'server')
      mkdirSync(join(serverDir, 'dist'), { recursive: true })
      mkdirSync(join(root, 'web', 'dist'), { recursive: true })
      writeFileSync(join(serverDir, 'package.json'), '{"name":"server"}')
      const entry = join(serverDir, 'dist', 'index.js')
      writeFileSync(entry, '')

      // cwd = the ROOT, not server/.
      expect(resolveClientDir('../web/dist', root, entry)).toBe(join(root, 'web', 'dist'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves an absolute clientDir untouched', () => {
    expect(resolveClientDir(dir, '/somewhere/else')).toBe(dir)
  })

  it('keeps the cwd candidate when neither location has the build', () => {
    // The warning names the cwd path, so a genuinely missing build must
    // resolve there rather than to some unrelated entry-relative guess.
    const missing = join(dir, 'nope')
    expect(resolveClientDir('nope', dir, undefined)).toBe(missing)
  })
})

describe('SpaAdapter — review follow-ups', () => {
  it('respects q=0 — text/html;q=0 means HTML is NOT acceptable', () => {
    // RFC 9110 §12.5.1: "a value of 0 means not acceptable". A substring
    // check read this as a yes and returned the document anyway.
    const { middleware } = buildAdapter()
    const res = dispatch(middleware, { url: '/dashboard', headers: { accept: 'text/html;q=0' } })
    expect(res.ended).toBe(false)
  })

  it('still serves when HTML carries a positive q', () => {
    const { middleware } = buildAdapter()
    for (const accept of ['text/html;q=0.9', 'text/html; q=1.0', 'application/xhtml+xml;q=0.8']) {
      expect(dispatch(middleware, { url: '/dashboard', headers: { accept } }).statusCode).toBe(200)
    }
  })

  it('picks HTML out of a real browser Accept header', () => {
    const { middleware } = buildAdapter()
    const accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    expect(dispatch(middleware, { url: '/dashboard', headers: { accept } }).statusCode).toBe(200)
  })

  it('gives the root path the index cache policy, not the asset one', () => {
    // `/` is served by the static layer from `clientDir/index.html`, so it
    // never reaches the fallback. Treating it as "not a file" left the most
    // common request in the app without the configured index policy — real
    // Express returned `public, max-age=0`, the static default.
    const { middleware } = buildAdapter()
    const res = dispatchCacheOnly(middleware, { url: '/', headers: HTML })
    expect(res.headers['cache-control']).toBe('no-cache')
  })

  it('treats an .html file as index, not as a long-lived asset', () => {
    const { middleware } = buildAdapter()
    const res = dispatchCacheOnly(middleware, { url: '/index.html', headers: HTML })
    expect(res.headers['cache-control']).toBe('no-cache')
  })

  it('survives a file vanishing between checks', () => {
    // A deploy can swap the directory mid-request. `existsSync` then
    // `statSync` threw ENOENT inside request handling; one stat in a
    // try/catch answers "not servable" instead.
    const { middleware } = buildAdapter()
    rmSync(dir, { recursive: true, force: true })
    expect(() =>
      dispatch(middleware, { url: '/assets/app.js', headers: { accept: '*/*' } }),
    ).not.toThrow()
  })
})
