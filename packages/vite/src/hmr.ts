import type { Plugin, HmrContext } from 'vite'
import type { PluginContext } from './context'
import { invalidateVirtualModules } from './virtual-modules'

/**
 * HMR plugin — handles hot updates for KickJS decorated modules.
 *
 * When a file containing @Controller/@Service decorators changes:
 * 1. Virtual modules are invalidated (container-registry regenerates)
 * 2. A custom HMR event `kickjs:module-update` is sent to the SSR runner
 * 3. The bootstrap() function's `import.meta.hot.accept()` picks up the change
 *
 * Config file changes (kick.config.ts) trigger a full server restart.
 * Module barrel changes (modules/index.ts) trigger a full restart to pick up
 * new modules added by the code generator.
 */
export function kickjsHmrPlugin(ctx: PluginContext): Plugin {
  return {
    name: 'kickjs:hmr',
    apply: 'serve', // Only active in dev mode

    configureServer(server) {
      // Watch for new file additions in the src directory — when the generator
      // creates new module files, Vite needs a full restart to pick them up.
      server.watcher.on('add', (file: string) => {
        if (file.endsWith('.ts') && !file.endsWith('.d.ts') && file.includes('/modules/')) {
          server.config.logger.info(`New module file detected: ${file}`, { timestamp: true })
          server.restart()
        }
      })
    },

    handleHotUpdate({ file, server }: HmrContext) {
      const relativePath = file.startsWith(ctx.root + '/') ? file.slice(ctx.root.length + 1) : file

      // Config file change → full restart
      if (
        relativePath === 'kick.config.ts' ||
        relativePath === 'kick.config.js' ||
        relativePath === 'kick.config.mjs'
      ) {
        server.restart()
        return []
      }

      // Module barrel change (e.g., modules/index.ts updated by generator) → full restart
      // so Vite re-evaluates all imports including newly added modules
      if (relativePath.endsWith('modules/index.ts')) {
        server.config.logger.info('Module registry changed, restarting...', { timestamp: true })
        server.restart()
        return []
      }

      // Check if this is a KickJS decorated module
      const isKickModule = ctx.discoveredModules.has(relativePath)

      if (isKickModule) {
        // Invalidate virtual modules so they regenerate
        invalidateVirtualModules(ctx)

        // Send custom HMR event for the DI system
        server.hot.send({
          type: 'custom',
          event: 'kickjs:module-update',
          data: {
            file: relativePath,
            kinds: [...(ctx.discoveredModules.get(relativePath) ?? [])],
          },
        })
      }

      // Let Vite handle the standard HMR flow (module graph invalidation)
      return undefined
    },
  }
}
