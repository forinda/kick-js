/**
 * Dev server plugin for KickJS — mounts the Express application on Vite's
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
 *     → ssrLoadModule('virtual:kickjs/app') → fresh Express app
 *     → Express handles request (routes, middleware, controllers)
 * ```
 *
 * @see v3/architecture.md Section 2.6 for the httpServer piping design
 * @see bench-mark/react-router-analysis.md for the pattern origin
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
 * cast is safe because Express only works with HTTP/1.1 servers.
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
 * - Loads fresh Express app on every request via `ssrLoadModule()`
 * - Fixes stack traces for SSR errors with `ssrFixStacktrace()`
 *
 * @param ctx - Shared plugin context (entry file, root directory)
 * @returns Vite plugin
 */
export function kickjsDevServerPlugin(ctx: PluginContext): Plugin {
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
     * files, HMR client, etc.), so Vite-handled requests never hit Express.
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
            // `app` is the configured Express instance (not yet listening).
            const expressApp = mod.app

            if (!expressApp?.handle) {
              // Entry file doesn't export an Express app — fall through to Vite's 404
              return next()
            }

            // Let Express handle the request.
            // If Express doesn't match any route, it calls next() and
            // Vite's default 404 handler takes over.
            expressApp.handle(req, res, (err?: any) => {
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
