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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineAdapter, Logger, RequestContext, RESPOND } from '@forinda/kickjs'
import { errorPage, isPageRequest, setInertiaRuntime, requestUrl, type Page } from './inertia'
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
  /**
   * Tags added to every page's `<head>` — a favicon, meta tags, fonts. Per-page
   * titles and meta belong in the page, with Inertia's `<Head>` component.
   */
  head?: string
  /** Replace the HTML shell entirely. */
  template?: HtmlTemplate
  /**
   * Page component for errors and unknown URLs, e.g. `'Error'`. It receives
   * `{ status, message }`. Unmatched page requests get it with 404; thrown
   * errors get it through `inertiaErrorHandler()`. API and asset requests
   * keep the usual JSON answers.
   */
  errorPage?: string
  /**
   * Render pages on the server. `entry` is a module whose default export is
   * `(page) => Promise<{ head: string[]; body: string }>` — what
   * `createInertiaApp({ page, render: renderToString, ... })` returns. Loaded
   * through Vite in dev; in production from `bundle`, the output of
   * `vite build --ssr <entry>` (default `'dist/ssr/ssr.js'`). A render that
   * throws falls back to client rendering for that request.
   */
  ssr?: { entry: string; bundle?: string }
}

/** What an SSR entry's default export returns. */
export interface SsrResult {
  head: string[]
  body: string
}

type SsrRender = (page: Page) => Promise<SsrResult>

const log = Logger.for('InertiaAdapter')

interface ViteModuleLike {
  url: string
  id: string | null
  importedModules: Set<ViteModuleLike>
}

interface ViteDevServerLike {
  config: { root: string }
  environments: { ssr: { moduleGraph: { getModuleById(id: string): ViteModuleLike | undefined } } }
  transformIndexHtml(url: string, html: string): Promise<string>
  ssrLoadModule(url: string): Promise<Record<string, unknown>>
  ssrFixStacktrace(err: Error): void
}

const CSS_REQUEST = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/

/**
 * Dev only: the stylesheets the SSR entry imports, as `<link>` tags. In dev
 * Vite injects CSS from JavaScript, so server-rendered HTML would show
 * unstyled until the scripts run. `data-vite-dev-id` lets Vite's client
 * recognize these and not inject the same styles again.
 */
function devStylesheets(vite: ViteDevServerLike, entry: string): string[] {
  const root = vite.environments.ssr.moduleGraph.getModuleById(resolve(vite.config.root, entry))
  if (!root) return []
  const links: string[] = []
  const seen = new Set<ViteModuleLike>()
  const walk = (mod: ViteModuleLike) => {
    if (seen.has(mod)) return
    seen.add(mod)
    if (CSS_REQUEST.test(mod.url)) {
      const devId = mod.id ? ` data-vite-dev-id="${mod.id.replace(/"/g, '&quot;')}"` : ''
      links.push(`<link rel="stylesheet" href="${mod.url}"${devId} />`)
      return
    }
    for (const imported of mod.importedModules) walk(imported)
  }
  walk(root)
  return links
}

function viteServer(): ViteDevServerLike | null {
  return (
    (globalThis as { __kickjs_viteServer?: ViteDevServerLike | null }).__kickjs_viteServer ?? null
  )
}

function appendVary(res: ServerResponse, field: string): void {
  const current = res.getHeader('Vary')
  const list = (Array.isArray(current) ? current.join(',') : String(current ?? ''))
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  if (list.includes('*') || list.some((v) => v.toLowerCase() === field.toLowerCase())) return
  res.setHeader('Vary', [...list, field].join(', '))
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
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
      // The same URL answers HTML or JSON depending on X-Inertia, so a shared
      // cache must key on it. Appended, not set: replacing a Vary another
      // layer added (Origin, Accept-Encoding) lets a cache serve one
      // client's variant to another.
      appendVary(res, 'X-Inertia')
      if (req.headers['x-inertia'] !== 'true') return next()

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
          // The whole build: hashed `assets/` plus what Vite copied from
          // `public/` — favicon, robots.txt, a static sitemap.
          if (existsSync(join(clientDir, 'package.json'))) {
            throw new Error(
              `InertiaAdapter: clientDir ${clientDir} looks like a project root — it must be the client build output (default dist/client), which is served as-is.`,
            )
          }
          // Not every engine's static handler skips dotfiles, so the build's
          // own (`.vite/manifest.json`) are refused here, before it runs.
          const hidden = new Set(readdirSync(clientDir).filter((name) => name.startsWith('.')))
          const hideBuildFiles: NodeMiddleware = (req, res, next) => {
            const first = safeDecode((req.url ?? '/').split('?')[0]!)
              .split('/')
              .find(Boolean)
            if (first && hidden.has(first)) {
              res.statusCode = 404
              res.end()
              return
            }
            next()
          }
          http.use(hideBuildFiles as never)
          http.serveStatic('/', clientDir)
        }
        if (config.version !== undefined) {
          const v = config.version
          version = typeof v === 'function' ? v : () => v
        }

        const ssr = config.ssr
        let prodRender: Promise<SsrRender> | undefined
        const loadRender = async (): Promise<SsrRender> => {
          if (vite) {
            // Every request in dev, so an edited page renders fresh.
            const mod = await vite.ssrLoadModule(`/${ssr!.entry.replace(/^\/+/, '')}`)
            return mod.default as SsrRender
          }
          const url = pathToFileURL(resolve(ssr!.bundle ?? 'dist/ssr/ssr.js')).href
          // The app's own build output, chosen at runtime — nothing for Vite to analyze.
          prodRender ??= import(/* @vite-ignore */ url).then((mod) => mod.default as SsrRender)
          return prodRender
        }
        const render = async (page: Page): Promise<SsrResult | null> => {
          if (!ssr) return null
          try {
            return await (
              await loadRender()
            )(page)
          } catch (err) {
            if (vite && err instanceof Error) vite.ssrFixStacktrace(err)
            log.error(err, `SSR failed for ${page.component} — sending it client-rendered`)
            return null
          }
        }

        setInertiaRuntime({
          version: () => version(),
          share: config.share,
          errorPage: config.errorPage,
          async renderHtml(page, ctx) {
            const rendered = await render(page)
            const styles = vite && rendered && ssr ? devStylesheets(vite, ssr.entry) : []
            const html = template({
              head: [config.head ?? '', head(page), ...styles, ...(rendered?.head ?? [])]
                .filter(Boolean)
                .join('\n    '),
              body: rendered?.body ?? pageBody(page),
              page,
            })
            return vite ? vite.transformIndexHtml(requestUrl(ctx.req), html) : html
          },
        })
      },

      middleware() {
        const pages = [{ handler: protocol as never, phase: 'afterGlobal' as const }]
        if (!config.errorPage) return pages
        const component = config.errorPage
        // Runs after every route: a page request that reaches it matched none.
        const notFound: NodeMiddleware = (req, res, next) => {
          if ((req.method !== 'GET' && req.method !== 'HEAD') || !isPageRequest(req.headers)) {
            return next()
          }
          const ctx = new RequestContext(req as never, res as never, next as never)
          Promise.resolve(errorPage(component, 404)[RESPOND](ctx)).catch(next)
        }
        return [...pages, { handler: notFound as never, phase: 'afterRoutes' as const }]
      },

      shutdown() {
        setInertiaRuntime(null)
      },
    }
  },
})
