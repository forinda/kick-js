import type { ViteDevServer } from 'vite'

/** Shared context between KickJS Vite plugins */
export interface PluginContext {
  /** User's app root directory */
  root: string
  /** Entry file for the server app (default: src/index.ts) */
  entry: string
  /** Vite dev server reference (set during configureServer) */
  server?: ViteDevServer
}

export function createPluginContext(options?: KickJSPluginOptions): PluginContext {
  return {
    root: process.cwd(),
    entry: options?.entry ?? 'src/index.ts',
  }
}

export interface KickJSPluginOptions {
  /** Server entry file (default: 'src/index.ts') */
  entry?: string
}
