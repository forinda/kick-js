import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Command } from 'commander'
import { runNodeWithEnv } from '../utils/shell'
import { loadKickConfig } from '../config'
import { runTypegen, writeTypegenArtifacts } from '../typegen'
import { runAllPluginTypegens } from '../typegen/run-plugins'
import { buildAssets } from '../asset-manager/build'

/**
 * Start the Vite dev server with @forinda/kickjs-vite plugin.
 *
 * The plugin (configured in the user's vite.config.ts) handles:
 * - SSR environment setup (kickjs:core)
 * - Module auto-discovery (kickjs:module-discovery)
 * - Selective HMR invalidation (kickjs:hmr)
 * - Virtual module generation (kickjs:virtual-modules)
 * - Express mounting + httpServer piping (kickjs:dev-server)
 *
 * This function just creates the Vite server, listens, and handles shutdown.
 * Vite owns the HTTP port — Express runs as post-middleware on Vite's server.
 */
/**
 * Resolve whether the dev server's chokidar should poll instead of
 * relying on `fs.watch` events. CLI flag wins over env var; default
 * is event-based (faster, lower CPU). Polling is the right choice in
 * Docker bind mounts, WSL crossing the WSL/Windows boundary, NFS,
 * and some old Linux kernels where new-file events get dropped.
 */
function resolvePolling(flag: boolean | undefined): boolean {
  if (typeof flag === 'boolean') return flag
  const env = process.env.KICKJS_WATCH_POLLING
  return env === '1' || env === 'true'
}

async function startDevServer(
  _entry: string,
  port?: string,
  opts: { polling?: boolean } = {},
): Promise<void> {
  if (port) process.env.PORT = port
  const polling = resolvePolling(opts.polling)

  // Generate `.kickjs/types/*.d.ts` once before Vite starts so the
  // user's tsc has fresh type info from the very first request.
  // `allowDuplicates: true` so an in-progress class rename can never
  // block the dev server — the colliding entries are auto-namespaced
  // and the warning is printed instead.
  const cwd = process.cwd()
  const devConfig = await loadKickConfig(cwd)
  const schemaValidator = devConfig?.typegen?.schemaValidator ?? 'zod'
  const envFile = devConfig?.typegen?.envFile
  try {
    await runTypegen({
      cwd,
      allowDuplicates: true,
      schemaValidator,
      envFile,
      srcDir: devConfig?.typegen?.srcDir,
      outDir: devConfig?.typegen?.outDir,
      assetMap: devConfig?.assetMap,
      // We invoke the plugin pipeline explicitly below; opting out
      // here keeps it from running twice on `kick dev` startup.
      runPlugins: false,
    })
  } catch (err: any) {
    console.warn(`  kick typegen: skipped (${err?.message ?? err})`)
  }

  // Plugin typegens — the sole emitter of `.kickjs/types/*`. Same
  // swallow-on-error semantics as the scan/gate pass above: a broken
  // plugin (or a scanner/fs error, or a writeTypegenArtifacts hiccup)
  // shouldn't block the dev server from coming up. `writeTypegenArtifacts`
  // then writes the `.kickjs/.gitignore` guard + sweeps legacy orphans.
  const typesOutDir = resolve(cwd, devConfig?.typegen?.outDir ?? '.kickjs/types')
  try {
    const startupPluginResults = await runAllPluginTypegens({ cwd, config: devConfig })
    await writeTypegenArtifacts(typesOutDir, startupPluginResults, false)
  } catch (err: any) {
    console.warn(`  kick typegen: plugin pass skipped (${err?.message ?? err})`)
  }

  // Resolve vite from the user's project, not the CLI package.
  // On Windows, require.resolve returns an absolute path like
  // `C:\...\vite\dist\node\index.js`, which Node's ESM loader rejects
  // (`Received protocol 'c:'`). Wrap in `pathToFileURL` so the loader
  // gets a valid `file://` URL on every platform.
  const { createRequire } = await import('node:module')
  const require = createRequire(resolve('package.json'))
  const vitePath = require.resolve('vite')
  const { createServer } = await import(pathToFileURL(vitePath).href)

  const server = await createServer({
    configFile: resolve('vite.config.ts'),
    server: {
      // Pass the port to Vite — it creates the httpServer
      port: port ? parseInt(port, 10) : undefined,
      // Polling chokidar — opt-in via --polling / KICKJS_WATCH_POLLING.
      // The default (event-based) is faster + lower CPU on bare metal,
      // but `add` events get dropped under Docker bind mounts, WSL
      // crossings, NFS, and some kernel/filesystem combos. Switching
      // to polling is the standard mitigation; 100ms interval matches
      // chokidar's documented sane default.
      ...(polling ? { watch: { usePolling: true as const, interval: 100 } } : {}),
    },
  })

  // Resolve the absolute paths of every assetMap.<ns>.src directory so
  // the watcher can treat any file change beneath them as an asset
  // change — regardless of extension, since adopters drop .ejs / .html
  // / .json / .md / .pug / etc. into a templates folder.
  const assetSrcRoots: readonly string[] = devConfig?.assetMap
    ? Object.values(devConfig.assetMap)
        .map((entry) => entry?.src)
        .filter((src): src is string => typeof src === 'string' && src.length > 0)
        .map((src) => resolve(cwd, src))
    : []
  const isAssetFile = (file: string): boolean =>
    assetSrcRoots.some((root) => file === root || file.startsWith(`${root}/`))

  // Re-run typegen whenever a source file changes. Vite already
  // owns a chokidar watcher, so we piggy-back on it instead of
  // adding our own — same files, no extra fd cost.
  //
  // Two trigger paths share one debounced run:
  //   1. .ts/.tsx/.mts/.cts changes → controllers / services / @Asset
  //      keys re-discovered, registry + augmentation files refresh.
  //   2. anything inside an `assetMap.<ns>.src` dir → KickAssets
  //      augmentation refreshes so TypeScript sees newly added templates.
  // Runtime resolution of new templates is handled in @forinda/kickjs
  // itself — the dev-mode resolver skips its module-level cache so each
  // `assets.x.y()` call re-walks. No Vite full-reload needed.
  // Batch every watcher event in the debounce window into one precise
  // delta. Vite tells us EXACTLY which files changed, so we feed that to
  // the incremental scanner — it re-extracts only those files and skips
  // the directory walk entirely (see `scanProjectIncremental`). The
  // previous code passed only the last file to a full re-scan; batching
  // a `changed`/`removed` set both fixes that and unlocks the fast path.
  let typegenTimer: ReturnType<typeof setTimeout> | null = null
  const pendingChanged = new Set<string>()
  const pendingRemoved = new Set<string>()
  // A directory removal can't be expressed as a precise file delta —
  // chokidar may emit a single `unlinkDir` instead of per-file `unlink`
  // events, so we can't know which cached files vanished. When that
  // happens we fall back to a full walk-based re-scan for this window,
  // which is always correct (it simply won't find the deleted files).
  let forceFullScan = false
  // Set when a file under an `assetMap.<ns>.src` dir changes — drives an
  // incremental `buildAssets` so the dist copies + manifest stay fresh
  // without re-copying every asset on every save (buildAssets skips
  // up-to-date files). Only meaningful when an assetMap is configured.
  let assetDirty = false
  const hasAssetMap = !!devConfig?.assetMap && Object.keys(devConfig.assetMap).length > 0
  const scheduleTypegen = (event: 'add' | 'change' | 'unlink' | 'unlinkDir', file: string) => {
    if (file.includes('.kickjs')) return
    if (event === 'unlinkDir') {
      // Only meaningful if the removed dir could have held scanned
      // sources or watched assets; cheap to just force a full scan.
      forceFullScan = true
      if (hasAssetMap) assetDirty = true
    } else {
      if (file.endsWith('.d.ts')) return
      const isTs = /\.(ts|tsx|mts|cts)$/.test(file)
      const isAsset = isAssetFile(file)
      if (!isTs && !isAsset) return
      if (isAsset && hasAssetMap) assetDirty = true
      // Only `.ts` files participate in the source scan delta. Asset-only
      // changes still trigger the pass (so the asset plugin re-emits) but
      // contribute nothing to the scan — an empty `.ts` delta makes the
      // incremental scan a near-instant cache replay.
      if (isTs) {
        if (event === 'unlink') {
          pendingRemoved.add(file)
          pendingChanged.delete(file)
        } else {
          pendingChanged.add(file)
          pendingRemoved.delete(file)
        }
      }
    }
    if (typegenTimer) clearTimeout(typegenTimer)
    typegenTimer = setTimeout(() => {
      // `undefined` delta → full scan (the `unlinkDir` correctness path).
      const delta = forceFullScan
        ? undefined
        : { changed: [...pendingChanged], removed: [...pendingRemoved] }
      const rebuildAssets = assetDirty
      pendingChanged.clear()
      pendingRemoved.clear()
      forceFullScan = false
      assetDirty = false
      runTypegen({
        cwd,
        silent: true,
        allowDuplicates: true,
        schemaValidator,
        envFile,
        srcDir: devConfig?.typegen?.srcDir,
        outDir: devConfig?.typegen?.outDir,
        assetMap: devConfig?.assetMap,
        changedFiles: delta,
        // Plugin pipeline runs separately just below; opting out here
        // avoids double-running it on every debounced trigger.
        runPlugins: false,
      }).catch(() => {})
      // Plugin typegens piggy-back on the same debounce — they re-emit
      // their `kick__*` files when sources (or templates) change. silent
      // so the dev console stays quiet; artifacts (.gitignore + sweep)
      // run after the pass.
      runAllPluginTypegens({ cwd, config: devConfig, silent: true, changedFiles: delta })
        .then((r) => writeTypegenArtifacts(typesOutDir, r, true))
        .catch(() => {})
      // Incrementally refresh the dist asset copies + manifest, but only
      // when an asset file actually changed this window. buildAssets
      // skips up-to-date files, so this is a cheap stat sweep + the
      // occasional changed-file copy — not a full re-copy every save.
      if (rebuildAssets) {
        buildAssets(devConfig, { cwd, silent: true }).catch(() => {})
      }
    }, 100)
  }
  server.watcher.on('add', (f: string) => scheduleTypegen('add', f))
  server.watcher.on('unlink', (f: string) => scheduleTypegen('unlink', f))
  server.watcher.on('change', (f: string) => scheduleTypegen('change', f))
  server.watcher.on('unlinkDir', (d: string) => scheduleTypegen('unlinkDir', d))
  // Vite's default watcher ignores extensions it doesn't compile;
  // explicitly subscribe asset src dirs so .ejs / .html changes land
  // in the typegen pipeline.
  if (assetSrcRoots.length > 0) {
    server.watcher.add(assetSrcRoots)
  }

  await server.listen()
  server.printUrls()

  console.log(`\n  KickJS dev server running (Vite + @forinda/kickjs-vite)\n`)

  // Graceful shutdown — Vite closes the server + all HMR connections.
  // The app suppresses its own signal handlers in dev (Vite owns the
  // lifecycle), so drive its graceful shutdown here: drain in-flight
  // requests + run adapter.shutdown() + emit shutdown logs BEFORE Vite
  // tears the server down. The hook is set on globalThis by
  // Application.start() once the app has bootstrapped (same process).
  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    if (typegenTimer) clearTimeout(typegenTimer)
    try {
      await (
        globalThis as { __kickjs_app_shutdown?: () => Promise<void> }
      ).__kickjs_app_shutdown?.()
    } catch (err: any) {
      console.error(`  app shutdown hook failed: ${err?.message ?? err}`)
    }
    await server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  // Windows delivers Ctrl+Break as SIGBREAK (and SIGTERM is never raised);
  // wire it so graceful shutdown works there too.
  process.on('SIGBREAK', shutdown)
}

export function registerRunCommands(program: Command): void {
  program
    .command('dev')
    .description('Start development server with Vite HMR (zero-downtime reload)')
    .option('-e, --entry <file>', 'Entry file', 'src/index.ts')
    .option('-p, --port <port>', 'Port number')
    .option(
      '--polling',
      'Force chokidar to poll for file changes (Docker / WSL / NFS / older kernels)',
    )
    .action(async (opts: any) => {
      try {
        await startDevServer(opts.entry, opts.port, { polling: opts.polling })
      } catch (err: any) {
        if (err.code === 'ERR_MODULE_NOT_FOUND' && err.message?.includes('vite')) {
          console.error('\n  Error: vite is not installed.\n  Run: pnpm add -D vite unplugin-swc\n')
        } else {
          console.error('\n  Dev server failed:', err.message ?? err)
        }
        process.exit(1)
      }
    })

  program
    .command('build')
    .description('Build for production via Vite')
    .action(async () => {
      console.log('\n  Building for production...\n')

      // Resolve vite from the user's project, not the CLI package.
      // `pathToFileURL` fixes the Windows ESM loader rejection of bare
      // absolute paths (see `startDevServer` above).
      const { createRequire } = await import('node:module')
      const require = createRequire(resolve('package.json'))
      const vitePath = require.resolve('vite')
      const { build } = await import(pathToFileURL(vitePath).href)
      await build({ configFile: resolve('vite.config.ts') })

      // Copy static directories to dist (e.g., templates, public assets)
      const config = await loadKickConfig(process.cwd())
      const copyDirs = config?.copyDirs ?? []

      if (copyDirs.length > 0) {
        console.log('\n  Copying directories to dist...')
        for (const entry of copyDirs) {
          const src = typeof entry === 'string' ? entry : entry.src
          const dest =
            typeof entry === 'string' ? join('dist', entry) : (entry.dest ?? join('dist', src))
          const srcPath = resolve(src)
          const destPath = resolve(dest)

          if (!existsSync(srcPath)) {
            console.log(`    ⚠ Skipped ${src} (not found)`)
            continue
          }

          mkdirSync(destPath, { recursive: true })
          cpSync(srcPath, destPath, { recursive: true })
          console.log(`    ✓ ${src} → ${dest}`)
        }
      }

      // Asset manager (assets-plan.md PR 2). Drives its own copy +
      // emits dist/.kickjs-assets.json for the runtime resolver. No-op
      // when assetMap is missing — silent for adopters who don't use it.
      if (config?.assetMap && Object.keys(config.assetMap).length > 0) {
        console.log('\n  Building asset map...')
        try {
          await buildAssets(config, { cwd: process.cwd() })
        } catch (err) {
          console.error(
            `    ✗ asset build failed: ${err instanceof Error ? err.message : String(err)}`,
          )
          process.exit(1)
        }
      }

      console.log('\n  Build complete.\n')
    })

  program
    .command('build:assets')
    .description(
      'Rebuild the .kickjs-assets.json manifest under the configured outDir (no JS rebuild)',
    )
    .action(async () => {
      const config = await loadKickConfig(process.cwd())
      if (!config?.assetMap || Object.keys(config.assetMap).length === 0) {
        console.log('  No assetMap entries — nothing to build.')
        return
      }
      console.log('\n  Building asset map...')
      try {
        await buildAssets(config, { cwd: process.cwd() })
        console.log('\n  Asset build complete.\n')
      } catch (err) {
        console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
    })

  program
    .command('start')
    .description('Start production server')
    .option('-e, --entry <file>', 'Entry file', 'dist/index.js')
    .option('-p, --port <port>', 'Port number')
    .action((opts: any) => {
      // Use `runNodeWithEnv` so env vars go through `child_process.env`
      // instead of a POSIX `FOO=bar node ...` prefix — the prefix form
      // only works under bash/zsh and breaks on Windows cmd.exe and
      // PowerShell, which is what broke `kick start` on Windows dev.
      const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' }
      if (opts.port) env.PORT = String(opts.port)
      runNodeWithEnv(opts.entry, env)
    })

  program
    .command('dev:debug')
    .description('Start dev server with Node.js inspector attached')
    .option('-e, --entry <file>', 'Entry file', 'src/index.ts')
    .option('-p, --port <port>', 'Port number')
    .option('--inspect-port <port>', 'Inspector port', '9229')
    .action(async (opts: any) => {
      // For debug mode, we need --inspect on the Node.js process itself.
      // Re-launch the dev command with NODE_OPTIONS=--inspect
      const inspectPort = opts.inspectPort ?? '9229'
      process.env.NODE_OPTIONS = `--inspect=0.0.0.0:${inspectPort}`
      console.log(`  Debugger: ws://0.0.0.0:${inspectPort}`)

      try {
        await startDevServer(opts.entry, opts.port)
      } catch (err: any) {
        console.error('\n  Dev server (debug) failed:', err.message ?? err)
        process.exit(1)
      }
    })
}
