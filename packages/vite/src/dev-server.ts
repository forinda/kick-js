import type { Plugin, ViteDevServer } from 'vite'
import type { PluginContext } from './context'

/**
 * Dev server plugin — runs KickJS on its own HTTP port with Vite as the
 * internal module loader and file watcher.
 *
 * This is a backend framework — no browser state to preserve. On any file
 * change, the Express app does a full rebuild (re-register modules, re-mount
 * routes, swap handler). Vite's port is internal and hidden from the user.
 *
 * Architecture:
 *   - Express listens on PORT (default 3000) — this is what clients hit
 *   - Vite runs internally for SSR module loading + chokidar file watching
 *   - File changes trigger app.rebuild() via Vite's HMR invalidation
 *   - Vite's own port is suppressed from output
 */
export function kickjsDevServerPlugin(ctx: PluginContext): Plugin {
  let entryImported = false

  return {
    name: 'kickjs:dev-server',
    apply: 'serve',

    config() {
      return {
        appType: 'custom',
        environments: {
          ssr: {},
        },
        server: {
          hmr: true,
        },
        // Suppress Vite's "Local: http://localhost:5173" output —
        // users should only see the Express port
        clearScreen: false,
      }
    },

    configureServer(server: ViteDevServer) {
      ctx.server = server

      // Override printUrls to suppress Vite's port from output
      server.printUrls = () => {}

      // Import the entry after Vite is ready — bootstrap() starts Express normally
      return async () => {
        if (entryImported) return
        entryImported = true

        const env = server.environments.ssr
        if (!env || !('runner' in env)) return

        try {
          await (env as any).runner.import(`/${ctx.entry}`)
        } catch (err: any) {
          server.config.logger.error(`Failed to import entry: ${ctx.entry}`)
          server.config.logger.error(err)
        }
      }
    },
  }
}
