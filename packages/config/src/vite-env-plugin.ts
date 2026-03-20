import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/**
 * Vite plugin that watches `.env` files and triggers a full reload
 * when they change. This ensures the dev server picks up environment
 * variable changes without a manual restart.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { envWatchPlugin } from '@forinda/kickjs-config'
 *
 * export default defineConfig({
 *   plugins: [swc.vite(), envWatchPlugin()],
 * })
 * ```
 */
export function envWatchPlugin(): Plugin {
  const envFiles = ['.env', '.env.local', '.env.development', '.env.production', '.env.test']

  return {
    name: 'kickjs-env-watch',

    configureServer(server) {
      const root = server.config.root

      for (const file of envFiles) {
        const filePath = path.resolve(root, file)
        if (fs.existsSync(filePath)) {
          server.watcher.add(filePath)
        }
      }

      server.watcher.on('change', (changedPath) => {
        const basename = path.basename(changedPath)
        if (envFiles.includes(basename)) {
          server.config.logger.info(`  .env changed (${basename}), triggering reload...`, {
            timestamp: true,
          })

          // Invalidate all modules to trigger full HMR rebuild
          const mods = server.moduleGraph.getModulesByFile(path.resolve(root, 'src/index.ts'))
          if (mods) {
            for (const mod of mods) {
              server.moduleGraph.invalidateModule(mod)
            }
          }

          server.ws.send({ type: 'full-reload' })
        }
      })
    },
  }
}
