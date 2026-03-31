import type { Plugin } from 'vite'
import { createPluginContext, type KickJSPluginOptions } from './context'
import { kickjsCorePlugin } from './core'
import { kickjsVirtualModules, virtualIds } from './virtual-modules'
import { kickjsModuleDiscovery } from './module-discovery'
import { kickjsHmrPlugin } from './hmr'
import { kickjsDevServerPlugin } from './dev-server'

/**
 * KickJS Vite plugin — first-class Vite integration for KickJS server apps.
 *
 * Returns an array of focused plugins following the React Router composition pattern:
 * - `kickjs:core` — base config (Node 20 target, SSR externals)
 * - `kickjs:virtual-modules` — virtual module resolution (server-entry, app-modules)
 * - `kickjs:module-discovery` — auto-discovers @Controller/@Service via transform hook
 * - `kickjs:hmr` — selective DI invalidation on file changes
 * - `kickjs:dev-server` — configures Vite for backend dev (middlewareMode, SSR env)
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { kickjs } from '@forinda/kickjs-vite'
 * import swc from 'unplugin-swc'
 *
 * export default defineConfig({
 *   plugins: [kickjs(), swc.vite()],
 * })
 * ```
 */
export function kickjs(options?: KickJSPluginOptions): Plugin[] {
  const ctx = createPluginContext(options)
  return [
    kickjsCorePlugin(ctx),
    kickjsVirtualModules(ctx),
    kickjsModuleDiscovery(ctx),
    kickjsHmrPlugin(ctx),
    kickjsDevServerPlugin(ctx),
  ]
}

// Re-export types and utilities
export type { KickJSPluginOptions } from './context'
export { virtualIds } from './virtual-modules'

// Typegen
export { generateContainerTypes, discoverClasses } from './typegen'
