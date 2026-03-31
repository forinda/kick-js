import type { Plugin } from 'vite'
import type { PluginContext } from './context'

/**
 * HMR plugin — full server reload on any source file change.
 *
 * This is a backend framework — no browser state to preserve.
 * On any .ts file change: Vite invalidates the module graph, bootstrap's
 * import.meta.hot.accept() fires, and rebuild() nukes the DI container +
 * Express app and recreates everything from scratch. Same port, fresh state.
 *
 * New files (from `kick g module`) trigger a full Vite restart since they
 * aren't in the module graph yet.
 */
export function kickjsHmrPlugin(ctx: PluginContext): Plugin {
  return {
    name: 'kickjs:hmr',
    apply: 'serve',

    configureServer(server) {
      // New .ts files in src/ → full Vite restart (not in module graph yet)
      server.watcher.on('add', (file: string) => {
        if (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.includes('node_modules')) {
          server.config.logger.info(`New file: ${file}`, { timestamp: true })
          server.restart()
        }
      })

      // Deleted .ts files → full restart to avoid stale module references
      server.watcher.on('unlink', (file: string) => {
        if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
          server.config.logger.info(`File removed: ${file}`, { timestamp: true })
          server.restart()
        }
      })
    },

    handleHotUpdate({ file, server }) {
      const relativePath = file.startsWith(ctx.root + '/') ? file.slice(ctx.root.length + 1) : file

      // Config file change → full restart
      if (/^kick\.config\.(ts|js|mjs)$/.test(relativePath)) {
        server.config.logger.info('Config changed, restarting...', { timestamp: true })
        server.restart()
        return []
      }

      // For .ts source files, let Vite's default HMR flow handle it.
      // The module graph invalidation propagates to the entry file,
      // bootstrap's import.meta.hot.accept() fires, and rebuild() runs.
      return undefined
    },
  }
}
