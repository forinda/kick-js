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

  /** HMR logger / behaviour overrides (see {@link HmrOptions}). */
  hmr?: HmrOptions
}

/**
 * Payload handed to {@link HmrOptions.onInvalidation}.
 *
 * `tokens` is the deduplicated batch flushed for one debounce window —
 * a mix of class names (`'UserController'`), v4 factory entries
 * (`'MyAdapter (defineAdapter)'`), and bare basenames (`'hello.ts'`)
 * for plain source files without kickjs patterns. `timestamp` matches
 * the value broadcast on the `kickjs:hmr` HMR client event so dev tools
 * can correlate.
 */
export interface HmrInvalidationContext {
  /** Token names / file basenames flushed in this debounce window. */
  tokens: readonly string[]
  /** Epoch ms when the batch was flushed. */
  timestamp: number
}

/**
 * HMR-related plugin options.
 *
 * Defaults preserve the existing `HMR invalidated N tokens: …` log line.
 * Adopters with custom dev tooling (Discord webhooks, structured JSON
 * logs, in-app overlays) override `onInvalidation`; tests / CI dev runs
 * usually want `silent: true`.
 */
export interface HmrOptions {
  /**
   * Suppress the built-in console log entirely. The `kickjs:hmr` HMR
   * event is still broadcast — DevTools / Swagger UI continue to react
   * to invalidations, only the terminal stays quiet.
   */
  silent?: boolean

  /**
   * Replace the built-in dev-console line with a custom function. When
   * provided, the default log is *not* printed (your function owns the
   * channel). Returning a string emits a single `console.log`; returning
   * `undefined` / `void` suppresses output entirely so you can route
   * elsewhere (pino, OTel span events, websocket, etc.).
   *
   * @example
   * ```ts
   * kickjsVitePlugin({
   *   hmr: {
   *     onInvalidation: ({ tokens }) => `↻ rebuilt: ${tokens.join(' · ')}`,
   *   },
   * })
   * ```
   */
  onInvalidation?: (context: HmrInvalidationContext) => string | undefined | void
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
