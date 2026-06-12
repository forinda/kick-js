/**
 * kickjs:typegen — typegen-on-save for plain `vite` boots.
 *
 * `kick dev` owns the typegen watcher when it boots Vite (it claims
 * ownership on `globalThis` before `createServer`). But adopters who
 * run bare `vite` (the pre-fix scaffold default, or any Vite-embedding
 * tool) historically got working HMR with silently frozen
 * `.kickjs/types` — new routes lost their typing until a manual
 * `kick typegen`.
 *
 * This plugin closes that gap: when nothing has claimed ownership, it
 * dynamically loads the PROJECT's `@forinda/kickjs-cli` (optional peer
 * — resolved from the project root, never bundled) and wires the same
 * `createTypegenDevWatcher` engine `kick dev` uses, plus one startup
 * catch-up pass. No CLI installed → quiet no-op with a one-line notice.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Plugin, ViteDevServer } from 'vite'

/** Mirror of the CLI's TYPEGEN_OWNER_KEY — string-duplicated so this
 * module never needs the CLI at import time. */
const OWNER_KEY = '__kickjs_typegen_owner'

/** Structural slice of the CLI surface this plugin consumes. */
export interface TypegenCliModule {
  loadKickConfig(cwd: string): Promise<unknown>
  createTypegenDevWatcher(opts: {
    cwd: string
    config: unknown
    emitWarning: (message: string) => void
  }): {
    handleWatchEvent(event: 'add' | 'change' | 'unlink' | 'unlinkDir', file: string): void
    runOnce(): void
    assetSrcRoots: readonly string[]
    dispose(): void
  }
}

/**
 * Resolve `@forinda/kickjs-cli` from the PROJECT root (not from this
 * package — under pnpm's strict layout the vite plugin can't see the
 * CLI through its own node_modules). Walks `node_modules` upward and
 * reads the manifest directly with fs: the CLI is ESM-only (no
 * `require` condition in its exports map), so `createRequire().resolve`
 * throws ERR_PACKAGE_PATH_NOT_EXPORTED and can't be used here.
 * Returns null when not installed or too old to export the watcher
 * engine.
 */
function resolveCliEntry(root: string): string | null {
  let dir = root
  for (;;) {
    const pkgDir = join(dir, 'node_modules', '@forinda', 'kickjs-cli')
    const manifestPath = join(pkgDir, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          exports?: Record<string, unknown>
          module?: string
          main?: string
        }
        const dot = pkg.exports?.['.'] as string | Record<string, unknown> | undefined
        const fromExports =
          typeof dot === 'string'
            ? dot
            : typeof dot?.import === 'string'
              ? dot.import
              : typeof (dot?.import as Record<string, unknown> | undefined)?.default === 'string'
                ? ((dot!.import as Record<string, unknown>).default as string)
                : typeof dot?.default === 'string'
                  ? (dot.default as string)
                  : undefined
        const entryRel = fromExports ?? pkg.module ?? pkg.main
        if (typeof entryRel === 'string') return join(pkgDir, entryRel)
      } catch {
        // Unreadable manifest — keep walking up.
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

async function loadCliFromProject(root: string): Promise<TypegenCliModule | null> {
  try {
    const entry = resolveCliEntry(root)
    if (!entry || !existsSync(entry)) return null
    const mod = (await import(pathToFileURL(entry).href)) as Partial<TypegenCliModule>
    if (
      typeof mod.createTypegenDevWatcher === 'function' &&
      typeof mod.loadKickConfig === 'function'
    ) {
      return mod as TypegenCliModule
    }
    return null
  } catch {
    return null
  }
}

export interface TypegenPluginOptions {
  /** Test seam — defaults to project-root resolution of the real CLI. */
  loadCli?: (root: string) => Promise<TypegenCliModule | null>
}

export function kickjsTypegenPlugin(opts: TypegenPluginOptions = {}): Plugin {
  const loadCli = opts.loadCli ?? loadCliFromProject
  return {
    name: 'kickjs:typegen',
    apply: 'serve',

    async configureServer(server: ViteDevServer) {
      // `kick dev` boots Vite in-process and runs its own watcher —
      // stand down so the pipeline never double-runs.
      if ((globalThis as Record<string, unknown>)[OWNER_KEY]) return

      const root = server.config.root
      const cli = await loadCli(root)
      if (!cli) {
        server.config.logger.info(
          '[kickjs] typegen-on-save disabled — @forinda/kickjs-cli not resolvable from the ' +
            'project (install it, or run `kick dev`).',
        )
        return
      }

      const config = await cli.loadKickConfig(root).catch(() => null)
      const watcher = cli.createTypegenDevWatcher({
        cwd: root,
        config,
        emitWarning: (message) => {
          server.config.logger.warn(message)
          server.hot.send({
            type: 'custom',
            event: 'kickjs:typegen-error',
            data: { message, timestamp: Date.now() },
          })
        },
      })

      // Startup catch-up — bare `vite` has no pre-server typegen pass
      // (kick dev runs one before createServer), so types may be stale
      // from edits made while no dev server was running.
      watcher.runOnce()

      server.watcher.on('add', (f: string) => watcher.handleWatchEvent('add', f))
      server.watcher.on('change', (f: string) => watcher.handleWatchEvent('change', f))
      server.watcher.on('unlink', (f: string) => watcher.handleWatchEvent('unlink', f))
      server.watcher.on('unlinkDir', (d: string) => watcher.handleWatchEvent('unlinkDir', d))
      if (watcher.assetSrcRoots.length > 0) {
        server.watcher.add([...watcher.assetSrcRoots])
      }
      if (server.httpServer) {
        server.httpServer.once('close', () => watcher.dispose())
      } else {
        // Middleware mode — no httpServer; tie disposal to the chokidar
        // watcher's own close so the debounce timer can't leak.
        server.watcher.once('close', () => watcher.dispose())
      }
    },
  }
}
