/**
 * Configuration types for the KickJS Vite plugin.
 *
 * @module @forinda/kickjs-vite/types
 */

/**
 * Options for the KickJS Vite plugin.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { kickjsVitePlugin } from '@forinda/kickjs-vite'
 *
 * export default defineConfig({
 *   plugins: [
 *     kickjsVitePlugin({
 *       entry: 'src/index.ts',
 *     }),
 *   ],
 * })
 * ```
 */
export interface KickJSPluginOptions {
  /**
   * Path to the application entry file, relative to the project root.
   * This file should export an Express app instance from `bootstrap()`.
   *
   * @default 'src/index.ts'
   *
   * @example
   * ```ts
   * // src/index.ts
   * import { bootstrap } from '@forinda/kickjs'
   * export const app = bootstrap({ modules: [...] })
   * ```
   */
  entry?: string
}

/**
 * Shared context passed between all KickJS sub-plugins.
 * Created once by the main plugin factory and shared via closure.
 */
export interface PluginContext {
  /** Resolved absolute path to the application entry file */
  entry: string
  /** Project root directory (from Vite config) */
  root: string
}
