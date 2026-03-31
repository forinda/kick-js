import type { Plugin, ViteDevServer } from 'vite'
import type { PluginContext } from './context'

/**
 * Dev server plugin — configures Vite for KickJS backend development.
 *
 * Sets up:
 * - SSR environment for server-side module loading
 * - Custom middleware mode (no built-in HTML serving)
 * - Server reference storage for other plugins
 */
export function kickjsDevServerPlugin(ctx: PluginContext): Plugin {
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
          middlewareMode: true,
          hmr: true,
        },
      }
    },

    configureServer(server: ViteDevServer) {
      // Store server reference for other plugins (HMR, virtual modules)
      ctx.server = server
    },
  }
}
