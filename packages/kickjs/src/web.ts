// `@forinda/kickjs/web` — the web-standard fetch entry for edge runtimes
// (Cloudflare Workers), Bun, and Deno. See web-standards-edge-design.md §3.
//
// PURITY CONTRACT: this entry's import graph must stay free of node-only
// runtime imports — no `node:http`, `node:cluster`, `node:fs`, `node:module`,
// no `express`, no `Application`/`bootstrap`. The single sanctioned node API
// is `node:async_hooks` (AsyncLocalStorage — available on Workers with
// `nodejs_compat`, Deno, and Bun). Enforced by the bundle-graph purity test.
//
// ```ts
// // Cloudflare Workers (wrangler.toml: compatibility_flags = ["nodejs_compat"])
// import { createWebApp } from '@forinda/kickjs/web'
// import * as h3 from 'h3'
// import { modules } from './modules'
//
// const app = createWebApp({ h3, modules })
// export default { fetch: (req: Request) => app.fetch(req) }
//
// // Bun
// Bun.serve({ fetch: (req) => app.fetch(req) })
// ```

import { Container } from './core/container'
import { MutableModuleRegistry } from './core/module-registry'
import type { AppModule, AppModuleClass, AppModuleEntry } from './core/app-module'
import type { ContributorRegistrations } from './core/context-decorator'
import type { SourcedRegistration } from './core/contributor-pipeline'
import { _setExternalContributorSources, buildRouteTable } from './http/router-builder'
import { requestStore } from './http/request-store'
import { compileWebRoute } from './http/web/handler'
import { normalizePath } from './core/path'

export { WebRequestShim, WebResponseDriver } from './http/web/driver'
export { compileWebRoute } from './http/web/handler'

// Minimal structural surface of h3 v2 used here (kept local so this entry
// never imports the node-coupled h3-web runtime module).
interface H3AppLike {
  on(method: string, path: string, handler: (event: H3EventLike) => unknown): unknown
  all(path: string, handler: (event: H3EventLike) => unknown): unknown
  fetch(request: Request): Promise<Response>
}
interface H3EventLike {
  req: Request
  url: URL
  context: { params?: Record<string, string> }
}

export interface CreateWebAppOptions {
  /**
   * The h3 v2 module, statically imported by the caller:
   * `import * as h3 from 'h3'`. Passed in (rather than loaded here) because
   * edge bundlers have no `createRequire`, and a static `import 'h3'` inside
   * this entry would force the peer on every consumer of the subpath.
   */
  h3: unknown
  /** App modules — same shapes `bootstrap({ modules })` accepts. */
  modules: AppModuleEntry[]
  /** Route prefix (default '/api') — parity with bootstrap. */
  apiPrefix?: string
  /** Default route version (default 1) — parity with bootstrap. */
  defaultVersion?: number
  /** Global Context Contributors — parity with `bootstrap({ contributors })`. */
  contributors?: ContributorRegistrations
  /**
   * Env values for ConfigService/@Value resolution. On Workers, pass the
   * `env` binding from the fetch handler (see `createFetchHandler`); on
   * Bun/Deno, ambient `process.env` already works and this can be omitted.
   */
  env?: Record<string, string | undefined>
}

export interface WebApp {
  /** Web-standard entry: `Request` in, `Response` out. */
  fetch: (request: Request) => Promise<Response>
  /** The underlying h3 v2 app, for advanced composition. */
  h3: unknown
}

/**
 * Build a KickJS app as a web-standard fetch handler — no node http server,
 * no Application/bootstrap. Module registration, DI, and the contributor
 * pipeline behave exactly like `bootstrap()`; routes are compiled once here
 * and served through h3 v2's router.
 */
export function createWebApp(options: CreateWebAppOptions): WebApp {
  const h3mod = options.h3 as { H3?: new () => H3AppLike }
  if (typeof h3mod?.H3 !== 'function') {
    throw new Error(
      '@forinda/kickjs/web: pass the h3 v2 module — `createWebApp({ h3: await import("h3"), ... })`. ' +
        "The installed h3 must be v2 (npm dist-tag 'latest'); v1 has no H3 class.",
    )
  }

  const container = Container.getInstance()

  // Wire ConfigService/@Value env resolution when the platform has no
  // ambient process.env (Workers). Latest-wins like loadEnv().
  if (options.env) {
    const env = options.env
    Container._envResolver = (key: string) => env[key]
  }

  // Request-scope provider — same wiring Application.setup() performs.
  Container._requestStoreProvider = () => requestStore.getStore() ?? null

  // Module mounting — mirrors Application.setup() steps 1:1 for the module
  // path (plugins/adapters are out of scope for the edge entry at launch).
  const registry = new MutableModuleRegistry()
  for (const m of options.modules) registry.mount(m)
  const modules = registry.entries.map((entry) => {
    const mod: AppModule = typeof entry === 'function' ? new (entry as AppModuleClass)() : entry
    mod.register?.(container)
    return mod
  })
  container.bootstrap()

  const app = new h3mod.H3()
  const apiPrefix = options.apiPrefix ?? '/api'
  const defaultVersion = options.defaultVersion ?? 1

  const globalSources: SourcedRegistration[] = (options.contributors ?? []).map(
    (registration): SourcedRegistration => ({
      source: 'global',
      registration: registration as SourcedRegistration['registration'],
      label: 'createWebApp',
    }),
  )

  for (const mod of modules) {
    const declaredName = (mod as { name?: unknown }).name
    const moduleLabel =
      typeof declaredName === 'string' && declaredName.length > 0
        ? declaredName
        : (mod.constructor?.name ?? 'module')
    const moduleSources: SourcedRegistration[] = (mod.contributors?.() ?? []).map(
      (registration): SourcedRegistration => ({
        source: 'module',
        registration,
        label: moduleLabel,
      }),
    )

    _setExternalContributorSources([...moduleSources, ...globalSources])
    try {
      const result = mod.routes()
      if (!result) continue
      const routeSets = Array.isArray(result) ? result : [result]
      for (const route of routeSets) {
        if (!route.controller) {
          throw new Error(
            `@forinda/kickjs/web: module route at '${route.path}' has no controller. ` +
              'Express-style `router` mounts are not supported on the web entry.',
          )
        }
        const version = route.version ?? defaultVersion
        const mountPath = `${apiPrefix}/v${version}${normalizePath(route.path)}`
        for (const entry of buildRouteTable(route.controller)) {
          const url = joinPath(mountPath, entry.path)
          const run = compileWebRoute(entry)
          app.on(entry.method, url, (event: H3EventLike) =>
            run({
              request: event.req,
              url: event.url,
              params: event.context.params ?? {},
            }),
          )
        }
      }
    } finally {
      _setExternalContributorSources([])
    }
  }

  return {
    fetch: (request: Request) => app.fetch(request),
    h3: app,
  }
}

/**
 * Cloudflare Workers convenience: lazily build the app on the first request
 * so the Workers `env` binding can seed config before any module resolves.
 *
 * ```ts
 * export default createFetchHandler((env) => ({ h3, modules, env }))
 * ```
 */
export function createFetchHandler(
  build: (env: Record<string, string | undefined>) => CreateWebAppOptions,
): { fetch: (request: Request, env?: Record<string, string | undefined>) => Promise<Response> } {
  let app: WebApp | undefined
  return {
    fetch: (request, env = {}) => {
      app ??= createWebApp(build(env))
      return app.fetch(request)
    },
  }
}

/** Join a mount prefix and a route path into one URL, collapsing slashes. */
function joinPath(mountPath: string, path: string): string {
  const a = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
  if (path === '/' || path === '') return a === '' ? '/' : a
  const b = path.startsWith('/') ? path : `/${path}`
  return `${a}${b}`
}
