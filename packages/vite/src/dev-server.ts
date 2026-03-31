import type { Plugin, ViteDevServer } from 'vite'
import type { PluginContext } from './context'

/**
 * Dev server plugin — configures Vite for KickJS backend development.
 *
 * Sets up:
 * - SSR environment for server-side module loading
 * - Auto-imports the KickJS entry file when Vite starts
 * - Server reference storage for other plugins
 *
 * Works with both `vite` CLI and `kick dev` (programmatic API).
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
      }
    },

    configureServer(server: ViteDevServer) {
      // Store server reference for other plugins (HMR, virtual modules)
      ctx.server = server

      // Import the KickJS entry after Vite is fully ready.
      // This runs the bootstrap() function which starts Express on its own port.
      return () => {
        if (entryImported) return
        entryImported = true

        const env = server.environments.ssr
        if (env && 'runner' in env) {
          ;(env as any).runner.import(`/${ctx.entry}`).catch((err: any) => {
            server.config.logger.error(`Failed to import entry: ${ctx.entry}`)
            server.config.logger.error(err)
          })
        }
      }
    },
  }
}
