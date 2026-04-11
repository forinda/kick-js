import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Command } from 'commander'
import { runShellCommand, runNodeWithEnv } from '../utils/shell'
import { loadKickConfig } from '../config'
import { runTypegen } from '../typegen'

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
async function startDevServer(_entry: string, port?: string): Promise<void> {
  if (port) process.env.PORT = port

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
    })
  } catch (err: any) {
    console.warn(`  kick typegen: skipped (${err?.message ?? err})`)
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
    },
  })

  // Re-run typegen whenever a source file changes. Vite already
  // owns a chokidar watcher, so we piggy-back on it instead of
  // adding our own — same files, no extra fd cost.
  let typegenTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleTypegen = (file: string) => {
    if (!/\.(ts|tsx|mts|cts)$/.test(file)) return
    if (file.includes('.kickjs')) return
    if (file.endsWith('.d.ts')) return
    if (typegenTimer) clearTimeout(typegenTimer)
    typegenTimer = setTimeout(() => {
      runTypegen({
        cwd,
        silent: true,
        allowDuplicates: true,
        schemaValidator,
        envFile,
        srcDir: devConfig?.typegen?.srcDir,
        outDir: devConfig?.typegen?.outDir,
      }).catch(() => {})
    }, 100)
  }
  server.watcher.on('add', scheduleTypegen)
  server.watcher.on('unlink', scheduleTypegen)
  server.watcher.on('change', scheduleTypegen)

  await server.listen()
  server.printUrls()

  console.log(`\n  KickJS dev server running (Vite + @forinda/kickjs-vite)\n`)

  // Graceful shutdown — Vite closes the server + all HMR connections
  const shutdown = async () => {
    if (typegenTimer) clearTimeout(typegenTimer)
    await server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

export function registerRunCommands(program: Command): void {
  program
    .command('dev')
    .description('Start development server with Vite HMR (zero-downtime reload)')
    .option('-e, --entry <file>', 'Entry file', 'src/index.ts')
    .option('-p, --port <port>', 'Port number')
    .action(async (opts: any) => {
      try {
        await startDevServer(opts.entry, opts.port)
      } catch (err: any) {
        if (err.code === 'ERR_MODULE_NOT_FOUND' && err.message?.includes('vite')) {
          console.error(
            '\n  Error: vite is not installed.\n' + '  Run: pnpm add -D vite unplugin-swc\n',
          )
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

      console.log('\n  Build complete.\n')
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
