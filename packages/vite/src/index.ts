/**
 * @forinda/kickjs-vite — Vite plugin for the KickJS framework.
 *
 * Provides first-class Vite integration for KickJS backend applications:
 * - **Dev server**: Mounts Express on Vite's HTTP server (single port)
 * - **HMR**: Fresh server code on every request via `ssrLoadModule()`
 * - **httpServer piping**: Real `http.Server` available to all adapters
 * - **Virtual modules**: Auto-generated application entry
 *
 * ## Quick Start
 *
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { kickjsVitePlugin } from '@forinda/kickjs-vite'
 * import swc from 'unplugin-swc'
 *
 * export default defineConfig({
 *   plugins: [
 *     swc.vite({ tsconfigFile: 'tsconfig.json' }),
 *     kickjsVitePlugin({ entry: 'src/index.ts' }),
 *   ],
 * })
 * ```
 *
 * ```ts
 * // src/index.ts
 * import { bootstrap } from '@forinda/kickjs'
 * import { UserModule } from './modules/users/user.module'
 *
 * // Export the Express app — Vite serves it in dev, you start it in prod
 * export const app = bootstrap({
 *   modules: [UserModule],
 *   middleware: [express.json()],
 * })
 *
 * // Production: start the server directly
 * if (process.env.NODE_ENV === 'production') {
 *   app.start()
 * }
 * ```
 *
 * ## Architecture
 *
 * The plugin returns an array of focused sub-plugins (React Router pattern):
 *
 * | Plugin | Responsibility |
 * |--------|---------------|
 * | `kickjs:core` | Vite config: appType, SSR environment, externals |
 * | `kickjs:virtual-modules` | `virtual:kickjs/app` resolution and generation |
 * | `kickjs:dev-server` | `configureServer()` — mounts Express, pipes httpServer |
 *
 * Future sub-plugins (v3 roadmap):
 * - `kickjs:module-discovery` — auto-discover `@Module` classes via `transform()`
 * - `kickjs:hmr` — selective container invalidation via `handleHotUpdate()`
 *
 * ## httpServer Piping
 *
 * Vite creates the `http.Server` — this plugin stores it on
 * `globalThis.__kickjs_httpServer`. KickJS adapters (WsAdapter, Socket.IO,
 * GraphQL subscriptions) attach to this server via the standard
 * `afterStart({ server })` hook. Zero adapter code changes needed.
 *
 * @see v3/architecture.md — Full architecture documentation
 * @see v3/plan.md — Implementation plan and rationale
 * @see bench-mark/react-router-analysis.md — Pattern origin
 *
 * @module @forinda/kickjs-vite
 */

import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import type { KickJSPluginOptions, PluginContext } from './types'
import { kickjsCorePlugin } from './core-plugin'
import { kickjsVirtualModulesPlugin } from './virtual-modules'
import { kickjsDevServerPlugin } from './dev-server'

/**
 * Create the KickJS Vite plugin array.
 *
 * Returns an array of focused sub-plugins that together provide full
 * Vite integration for KickJS backend applications. Each sub-plugin
 * has a single responsibility and runs at the appropriate Vite lifecycle stage.
 *
 * @param options - Plugin configuration
 * @param options.entry - Path to app entry file (default: 'src/index.ts')
 * @returns Array of Vite plugins
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { kickjsVitePlugin } from '@forinda/kickjs-vite'
 * import swc from 'unplugin-swc'
 *
 * export default defineConfig({
 *   plugins: [
 *     swc.vite({ tsconfigFile: 'tsconfig.json' }),
 *     kickjsVitePlugin(),
 *   ],
 * })
 * ```
 */
export function kickjsVitePlugin(options: KickJSPluginOptions = {}): Plugin[] {
  const entry = options.entry ?? 'src/index.ts'

  // Create shared context — resolved lazily in config hook since we
  // don't have the root directory until Vite resolves its config.
  const ctx: PluginContext = {
    entry,
    root: process.cwd(),
  }

  // Wrapper plugin that resolves the root directory before sub-plugins run
  const rootResolver: Plugin = {
    name: 'kickjs:root-resolver',
    configResolved(config) {
      ctx.root = config.root
      ctx.entry = resolve(config.root, entry)
    },
  }

  return [
    rootResolver,
    kickjsCorePlugin(ctx),
    kickjsVirtualModulesPlugin(ctx),
    kickjsDevServerPlugin(ctx),
  ]
}

// Re-export types for consumers
export type { KickJSPluginOptions, PluginContext } from './types'
