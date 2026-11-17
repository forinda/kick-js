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
  return {
    name: 'kickjs-env-watch',

    configureServer(server) {
      const root = server.config.root
      // Against the working directory, as the loader reads them.
      const envFiles = new Set(envFileCandidates().map((file) => path.resolve(file)))

      // Watched whether or not they exist yet: creating the first `.env`
      // (or deleting `.env.local`) reloads too, not only editing one.
      for (const file of envFiles) server.watcher.add(file)

      const onEnvFile = (event: string) => (changedPath: string) => {
        const basename = path.basename(changedPath)
        if (envFiles.has(path.resolve(changedPath))) {
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

/**
 * The files `@forinda/kickjs` may read for this dev server's mode: the ones
 * `KICKJS_ENV_FILE` names, or `.env.[mode].local`, `.env.[mode]`,
 * `.env.local` and `.env`. Kept here rather than imported, since this
 * package supports kickjs versions without such an export.
 */
export function envFileCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.KICKJS_ENV_FILE
  if (explicit === 'off' || explicit === 'none') return []
  if (explicit) {
    return explicit
      .split(',')
      .map((file) => file.trim())
      .filter(Boolean)
  }
  // A Vitest run is mode `test` whatever NODE_ENV says, as in the loader.
  const mode = env.VITEST ? 'test' : (env.NODE_ENV ?? 'development')
  return [`.env.${mode}.local`, `.env.${mode}`, '.env.local', '.env']
}
