/**
 * `InertiaAdapter` — wires the protocol into the app:
 *
 * - makes `inertia()` able to render (HTML shell, asset tags, version);
 * - answers a stale Inertia GET with 409 so the client reloads the page;
 * - turns a 302 after PUT / PATCH / DELETE into 303, so the browser follows
 *   with a GET instead of repeating the method;
 * - in production, serves the built client's `assets/`.
 *
 * @module @forinda/kickjs-inertia/adapter
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineAdapter, type RequestContext } from '@forinda/kickjs'
import { setInertiaRuntime, requestUrl, type Page } from './inertia'
import { defaultTemplate, devHead, manifestHead, pageBody, type HtmlTemplate } from './html'

export interface InertiaAdapterOptions {
  /**
   * The client entry, relative to the project root — the file that calls
   * `createInertiaApp`. Served by Vite in dev, looked up in the build
   * manifest in production. Default: `'src/client/main.tsx'`.
   */
  entry: string
  /** Where `vite build` wrote the client, with `build.manifest: true`. Default: `'dist/client'`. */
  clientDir: string
  /**
   * Asset version. A client on another version reloads the page on its next
   * visit. Default: a hash of the build manifest in production, none in dev
   * (Vite reloads changed modules itself).
   */
  version?: string | (() => string)
  /** Props every page gets — the current user, app name. */
  share?: (ctx: RequestContext) => Record<string, unknown> | Promise<Record<string, unknown>>
  /** `<title>` of the default HTML shell. */
  title: string
  /** Replace the HTML shell entirely. */
  template?: HtmlTemplate
}

interface ViteDevServerLike {
  transformIndexHtml(url: string, html: string): Promise<string>
}

function viteServer(): ViteDevServerLike | null {
  return (
    (globalThis as { __kickjs_viteServer?: ViteDevServerLike | null }).__kickjs_viteServer ?? null
  )
}

type NodeMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void

export const InertiaAdapter = defineAdapter<InertiaAdapterOptions>({
  name: 'InertiaAdapter',
  defaults: {
    entry: 'src/client/main.tsx',
    clientDir: 'dist/client',
    title: 'KickJS',
  },
  build: (config) => {
    const clientDir = resolve(config.clientDir)
    const template = config.template ?? defaultTemplate(config.title)
    let version: () => string | null = () => null

    const protocol: NodeMiddleware = (req, res, next) => {
      if (req.headers['x-inertia'] !== 'true') return next()
      res.setHeader('Vary', 'X-Inertia')

      const current = version()
      if (req.method === 'GET' && current && req.headers['x-inertia-version'] !== current) {
        res.statusCode = 409
        res.setHeader('X-Inertia-Location', requestUrl(req))
        res.end()
        return
      }

      if (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
        // Node sends every status through writeHead — also the implicit one
        // behind res.end() — so this catches a 302 from any code path.
        const writeHead = res.writeHead
        res.writeHead = function (this: ServerResponse, status: number, ...rest: unknown[]) {
          return (writeHead as (...a: unknown[]) => ServerResponse).call(
            this,
            status === 302 ? 303 : status,
            ...rest,
          )
        } as typeof res.writeHead
      }
      next()
    }

    return {
      beforeMount({ http }) {
        const vite = viteServer()
        let head: (page: Page) => string

        if (vite) {
          head = () => devHead(config.entry)
        } else {
          const tags = manifestHead(clientDir, config.entry)
          head = () => tags
          const hash = createHash('sha1')
            .update(readFileSync(join(clientDir, '.vite', 'manifest.json')))
            .digest('hex')
            .slice(0, 12)
          version = () => hash
          http.serveStatic('/assets', join(clientDir, 'assets'))
        }
        if (config.version !== undefined) {
          const v = config.version
          version = typeof v === 'function' ? v : () => v
        }

        setInertiaRuntime({
          version: () => version(),
          share: config.share,
          async renderHtml(page, ctx) {
            const html = template({ head: head(page), body: pageBody(page), page })
            return vite ? vite.transformIndexHtml(requestUrl(ctx.req), html) : html
          },
        })
      },

      middleware() {
        return [{ handler: protocol as never, phase: 'afterGlobal' as const }]
      },

      shutdown() {
        setInertiaRuntime(null)
      },
    }
  },
})
