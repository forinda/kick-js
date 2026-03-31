import type { Plugin, ViteDevServer } from 'vite'
import type { PluginContext } from './context'

/**
 * Dev server plugin — mounts KickJS Express app as middleware on Vite's dev server.
 *
 * Following the React Router pattern: everything runs on one port (Vite's port).
 * The plugin imports the entry file which runs bootstrap(). Bootstrap detects
 * the KICK_VITE env var and calls registerOnly() instead of start(), so it
 * sets up routes/middleware/DI without starting a separate HTTP server.
 * The Express app is then mounted on Vite's middleware stack.
 */
export function kickjsDevServerPlugin(ctx: PluginContext): Plugin {
  let entryImported = false

  return {
    name: 'kickjs:dev-server',
    apply: 'serve',

    config() {
      // Signal to bootstrap() that we're running inside the Vite plugin
      process.env.KICK_VITE = '1'

      return {
        appType: 'custom',
        environments: {
          ssr: {},
        },
        server: {
          hmr: true,
        },
      }
    },

    configureServer(server: ViteDevServer) {
      // Store server reference for other plugins (HMR, virtual modules)
      ctx.server = server

      // Mount the KickJS app as middleware on Vite's server after all other
      // middleware. This runs in the "return" phase of configureServer,
      // which executes after Vite's built-in middleware.
      return async () => {
        if (entryImported) return
        entryImported = true

        const env = server.environments.ssr
        if (!env || !('runner' in env)) return

        try {
          // Import the entry — bootstrap() will detect KICK_VITE and call
          // registerOnly() instead of start(), setting up DI + routes without listening.
          await (env as any).runner.import(`/${ctx.entry}`)

          // Get the Express app from globalThis.__app (set by bootstrap)
          const g = globalThis as any
          if (g.__app && typeof g.__app.getExpressApp === 'function') {
            const expressApp = g.__app.getExpressApp()
            // Mount the Express app as catch-all middleware on Vite's server
            server.middlewares.use(expressApp)
            server.config.logger.info(`KickJS app mounted on Vite server (single port)`, {
              timestamp: true,
            })
          }
        } catch (err: any) {
          server.config.logger.error(`Failed to import entry: ${ctx.entry}`)
          server.config.logger.error(err)
        }
      }
    },
  }
}
