/**
 * Serve a file's precompressed sibling — `app.js.br`, `app.js.gz` — when the
 * client accepts it. In front of `serve-static` on every runtime, so one
 * `.br` written at build time saves compressing the file on each request.
 */
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { ConnectHandler, ConnectNext } from '../connect'

/**
 * The text types worth compressing, by extension — the files a sibling is
 * looked for, and the ones `kick build` precompresses. Their `Content-Type`
 * is the original file's, not the sibling's.
 */
export const COMPRESSIBLE_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  wasm: 'application/wasm',
}

/** Preferred first. */
const ENCODINGS = [
  ['br', '.br'],
  ['gzip', '.gz'],
] as const

/** Whether `Accept-Encoding` allows `encoding` — named, or via `*`, and not `q=0`. */
export function acceptsEncoding(header: string, encoding: string): boolean {
  let star = false
  for (const part of header.toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';')
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    const allowed = !q || Number(q.slice(2)) > 0
    if (name === encoding) return allowed
    if (name === '*') star = allowed
  }
  return star
}

/** Wrap a `serve-static` handler for `root` so it serves precompressed siblings. */
export function withPrecompressed(root: string, serve: ConnectHandler): ConnectHandler {
  const base = resolve(root)
  return (req, res, next) => {
    // A byte range is a range of the file as stored; serve the original.
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.headers.range) {
      return serve(req, res, next)
    }
    const url = req.url
    const q = url.indexOf('?')
    // serve-static answers a directory with its index.html; so does this.
    const pathname = (q === -1 ? url : url.slice(0, q)).replace(/\/$/, '/index.html')
    let rel: string
    try {
      rel = decodeURIComponent(pathname)
    } catch {
      return serve(req, res, next)
    }
    const type = COMPRESSIBLE_TYPES[extname(rel).slice(1).toLowerCase()]
    if (!type) return serve(req, res, next)
    const file = join(base, normalize(rel))
    if (!file.startsWith(base + sep)) return serve(req, res, next)

    // Whether the response is compressed depends on the request's encoding.
    const vary = String(res.getHeader('Vary') ?? '')
    if (!/\baccept-encoding\b/i.test(vary)) {
      res.setHeader('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding')
    }
    const accept = String(req.headers['accept-encoding'] ?? '')
    ;(async () => {
      // A sibling stands in for its file — never for one that's gone.
      if (!(await stat(file).catch(() => undefined))?.isFile()) return serve(req, res, next)
      for (const [encoding, ext] of ENCODINGS) {
        if (!acceptsEncoding(accept, encoding)) continue
        const sibling = await stat(file + ext).catch(() => undefined)
        if (!sibling?.isFile()) continue
        res.setHeader('Content-Encoding', encoding)
        // serve-static types the response by the path it serves only when
        // nothing has set a type — so the sibling is served as the original.
        res.setHeader('Content-Type', type)
        req.url = pathname + ext + (q === -1 ? '' : url.slice(q))
        // The sibling went away before serve-static read it: undo, carry on.
        const restore: ConnectNext = (err) => {
          res.removeHeader('Content-Encoding')
          res.removeHeader('Content-Type')
          req.url = url
          next(err)
        }
        return serve(req, res, restore)
      }
      serve(req, res, next)
    })().catch(next)
  }
}
