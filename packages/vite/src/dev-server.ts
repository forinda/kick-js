import type { Plugin, ViteDevServer } from 'vite'
import type { PluginContext } from './context'

/**
 * Dev server plugin — imports the KickJS entry via Vite's SSR runner.
 *
 * Express owns the HTTP port (default 3000). Vite runs internally for
 * module loading and file watching only — its port is hidden from users.
 *
 * On file changes, Vite's HMR invalidates the module graph. bootstrap()'s
 * import.meta.hot.accept() fires, calling rebuild() which nukes everything
 * (Container, Express app, routes) and recreates from scratch on the same port.
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
        clearScreen: false,
      }
    },

    configureServer(server: ViteDevServer) {
      ctx.server = server

      // Hide Vite's port — users only see the Express port
      server.printUrls = () => {}

      // Import the entry after Vite middleware is ready
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
