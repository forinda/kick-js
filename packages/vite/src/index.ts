import type { Plugin } from 'vite'
import { createPluginContext, type KickJSPluginOptions } from './context'
import { kickjsCorePlugin } from './core'
import { kickjsHmrPlugin } from './hmr'
import { kickjsDevServerPlugin } from './dev-server'

/**
 * KickJS Vite plugin — dev server integration for KickJS backend apps.
 *
 * Returns an array of focused plugins:
 * - `kickjs:core` — base config (Node 20 target, SSR externals)
 * - `kickjs:hmr` — full reload on file changes (new/deleted files restart Vite)
 * - `kickjs:dev-server` — imports entry via SSR runner, hides Vite's port
 *
 * Express owns the HTTP port (default 3000). Vite runs internally for
 * module loading and file watching. On any change, the entire app rebuilds —
 * no surgical HMR needed for a backend framework.
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
  return [kickjsCorePlugin(ctx), kickjsHmrPlugin(ctx), kickjsDevServerPlugin(ctx)]
}

// Re-export types and utilities
export type { KickJSPluginOptions } from './context'

// Typegen
export { generateContainerTypes, discoverClasses } from './typegen'
