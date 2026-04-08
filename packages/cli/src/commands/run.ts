import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { Command } from 'commander'
import { runShellCommand } from '../utils/shell'
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
  // Failures here are non-fatal — we don't want a typegen bug to
  // block the dev server.
  try {
    await runTypegen({ cwd: process.cwd() })
  } catch (err: any) {
    console.warn(`  kick typegen: skipped (${err?.message ?? err})`)
  }

  // Resolve vite from the user's project, not the CLI package
  const { createRequire } = await import('node:module')
  const require = createRequire(resolve('package.json'))
  const vitePath = require.resolve('vite')
  const { createServer } = await import(vitePath)

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
      runTypegen({ cwd: process.cwd(), silent: true }).catch(() => {})
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

      // Resolve vite from the user's project, not the CLI package
      const { createRequire } = await import('node:module')
      const require = createRequire(resolve('package.json'))
      const vitePath = require.resolve('vite')
      const { build } = await import(vitePath)
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
      const envVars: string[] = ['NODE_ENV=production']
      if (opts.port) envVars.push(`PORT=${opts.port}`)
      runShellCommand(`${envVars.join(' ')} node ${opts.entry}`)
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
