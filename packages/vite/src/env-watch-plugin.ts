import path from 'node:path'
import { reloadEnv } from '@forinda/kickjs'
import type { Plugin } from 'vite'

/**
 * Vite plugin that watches `.env` files and triggers a full reload
 * when they change. This ensures the dev server picks up environment
 * variable changes without a manual restart.
 *
 * Lives in `@forinda/kickjs-vite` so all Vite-only concerns are in one
 * place.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { envWatchPlugin } from '@forinda/kickjs-vite'
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

      // Watched whether or not they exist yet: creating the first `.env`
      // (or deleting `.env.local`) reloads too, not only editing one.
      for (const file of envFiles) server.watcher.add(path.resolve(root, file))

      const onEnvFile = (event: string) => (changedPath: string) => {
        const basename = path.basename(changedPath)
        if (envFiles.includes(basename)) {
          server.config.logger.info(`  .env ${event} (${basename}), triggering reload...`, {
            timestamp: true,
          })

          // Re-read the .env file into process.env *before* invalidating
          // modules. Without this, the next SSR evaluation parses the
          // (stale) cached env snapshot — Zod throws on the missing key
          // and the user has to hard-restart the dev server.
          try {
            reloadEnv()
          } catch (err: any) {
            server.config.logger.warn(
              `  env reload failed: ${err?.message ?? err} — restart may be required`,
              { timestamp: true },
            )
          }

          // Invalidate all modules to trigger full HMR rebuild
          const mods = server.moduleGraph.getModulesByFile(path.resolve(root, 'src/index.ts'))
          if (mods) {
            for (const mod of mods) {
              server.moduleGraph.invalidateModule(mod)
            }
          }

          server.ws.send({ type: 'full-reload' })
        }
      }
      server.watcher.on('change', onEnvFile('changed'))
      server.watcher.on('add', onEnvFile('created'))
      server.watcher.on('unlink', onEnvFile('deleted'))
    },
  }
}
