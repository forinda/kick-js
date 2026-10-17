/**
 * Dev server plugin for KickJS — mounts the application on Vite's
 * HTTP server using the `configureServer` hook.
 *
 * ## Architecture
 *
 * In development, Vite owns the HTTP port and creates the `http.Server`.
 * This plugin:
 *
 * 1. **Stores `viteServer.httpServer` on `globalThis`** so KickJS adapters
 *    (WsAdapter, Socket.IO, GraphQL subscriptions) can attach to the real
 *    server via `server.on('upgrade', ...)`. This is the key to supporting
 *    any library that needs the raw `http.Server`.
 *
 * 2. **Registers a post-middleware** that loads the KickJS app through
 *    Vite's SSR transform pipeline on every request. When source files
 *    change, Vite invalidates the module graph and the next request
 *    gets fresh code — no process restart needed.
 *
 * 3. **Stores the Vite server reference** on `globalThis` so SSR
 *    renderers can use `createViteRuntime()`.
 *
 * ## Why NOT middlewareMode
 *
 * The initial KickJS Vite plugin attempt used `middlewareMode: true`, which
 * makes `viteServer.httpServer = null`. This broke WsAdapter and any library
 * needing `server.on('upgrade', ...)`. By letting Vite create the server,
 * `httpServer` is the real `http.Server` — adapters attach to it seamlessly.
 *
 * ## Request Flow
 *
 * ```
 * HTTP Request → Vite static middleware (HMR, assets)
 *   → If Vite handles it → done
 *   → If not → KickJS post-middleware
 *     → ssrLoadModule('virtual:kickjs/app') → fresh app
 *     → the app handles the request on its runtime (Express, Fastify or h3)
 * ```
 *
 *
 * @module @forinda/kickjs-vite/dev-server
 */

import type { Plugin, ViteDevServer } from 'vite'
import type { PluginContext } from './types'
import { VIRTUAL_APP } from './virtual-modules'

/**
 * Declare the globalThis properties used for cross-module communication.
 * These persist across Vite's `ssrLoadModule()` re-evaluations.
 *
 * `__kickjs_httpServer` uses the same `HttpServer` type that Vite uses
 * internally (union of http.Server | https.Server | Http2SecureServer).
 * KickJS adapters receive it as `http.Server` via AdapterContext — the
 * cast is safe because the dev server is HTTP/1.1.
 */
declare global {
  // eslint-disable-next-line no-var
  var __kickjs_httpServer: any
  // eslint-disable-next-line no-var
  var __kickjs_viteServer: ViteDevServer | null
}

/**
 * Creates the dev server plugin.
 *
 * This is the critical integration point between Vite and KickJS:
 * - Pipes `viteServer.httpServer` to adapters via `globalThis`
 * - Loads a fresh app on every request via `ssrLoadModule()`
 * - Fixes stack traces for SSR errors with `ssrFixStacktrace()`
 *
 * @param ctx - Shared plugin context (entry file, root directory)
 * @returns Vite plugin
 */
export function kickjsDevServerPlugin(_ctx: PluginContext): Plugin {
  return {
    name: 'kickjs:dev-server',

    /**
     * Configure the Vite dev server.
     *
     * The `configureServer` hook runs after Vite creates the HTTP server.
     * We use it to:
     * 1. Store the httpServer on globalThis (for WsAdapter, Socket.IO, etc.)
     * 2. Store the Vite server reference (for SSR rendering)
     * 3. Return a post-middleware that loads the KickJS app on each request
     *
     * Returning a function from `configureServer` registers it as a
     * **post-middleware** — it runs AFTER Vite's own middleware (static
     * files, HMR client, etc.), so Vite-handled requests never reach the app.
     */
    configureServer(viteServer: ViteDevServer) {
      // ━━━ Store the REAL http.Server on globalThis ━━━
      // This is the key to supporting Socket.IO, WsAdapter, GraphQL WS,
      // and any library that needs `server.on('upgrade', ...)`.
      //
      // Application.start() detects this and skips creating its own server:
      //   if (globalThis.__kickjs_httpServer) → reuse Vite's server
      //   else → create own http.Server (production mode)
      //
      // Adapters receive the server in afterStart({ server }) — same API
      // in both dev and prod. Zero adapter code changes needed.
      globalThis.__kickjs_httpServer = viteServer.httpServer ?? null
      globalThis.__kickjs_viteServer = viteServer

      // ━━━ Eagerly bootstrap the app once the server is listening ━━━
      // The post-middleware below only evaluates the entry on the FIRST
      // request (lazy SSR). That means `bootstrap()`, adapter
      // `afterStart`, and the app's startup logs don't run until someone
      // hits the URL — the app looks "not started" until then. Warm the
      // module once the HTTP server is listening so startup behaves like
      // `node`/`tsx` (logs + adapters + the in-dev shutdown hook ready
      // immediately). Errors surface with a fixed stacktrace.
      const warm = () => {
        viteServer.ssrLoadModule(VIRTUAL_APP).catch((err: unknown) => {
          if (err instanceof Error) viteServer.ssrFixStacktrace(err)
          viteServer.config.logger.error(
            `[kickjs] failed to bootstrap app on startup: ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
        })
      }
      const httpServer = viteServer.httpServer
      if (httpServer) {
        if (httpServer.listening) warm()
        else httpServer.once('listening', warm)
      }

      // Return post-middleware — runs after Vite's static/HMR middleware
      return () => {
        viteServer.middlewares.use(async (req, res, next) => {
          try {
            // Load the KickJS app through Vite's SSR transform pipeline.
            // On first request: evaluates the entry file and all imports.
            // On subsequent requests: returns cached modules (or re-evaluates
            // if source files changed since last request).
            //
            // This is the same pattern React Router and TanStack Start use.
            const mod = await viteServer.ssrLoadModule(VIRTUAL_APP)

            // The entry file exports: export const app = bootstrap({ modules })
            // `app` is the configured Application (not yet listening).
            const kickApp = mod.app

            if (!kickApp?.handle) {
              // Entry file doesn't export an app — fall through to Vite's 404
              return next()
            }

            // Let the app handle the request.
            // If no route matches, it calls next() and
            // Vite's default 404 handler takes over.
            kickApp.handle(req, res, (err?: any) => {
              if (err) {
                // Fix stack traces to point to original source (not compiled)
                if (err instanceof Error) {
                  viteServer.ssrFixStacktrace(err)
                }
                return next(err)
              }
              next()
            })
          } catch (err) {
            // SSR load/evaluation error (syntax error, missing import, etc.)
            if (err instanceof Error) {
              viteServer.ssrFixStacktrace(err)
            }
            next(err)
          }
        })
      }
    },
  }
}
