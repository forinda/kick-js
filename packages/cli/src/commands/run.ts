import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { Command } from 'commander'
import { runShellCommand } from '../utils/shell'
import { loadKickConfig } from '../config'

/**
 * Start the Vite dev server using RunnableDevEnvironment.
 * Replaces the old `npx vite-node --watch` approach — no separate dependency needed.
 */
async function startDevServer(entry: string, port?: string): Promise<void> {
  // Set port before Vite server creation so the app picks it up
  if (port) process.env.PORT = port

  // Resolve vite from the user's project, not the CLI package
  const { createRequire } = await import('node:module')
  const require = createRequire(resolve('package.json'))
  const vitePath = require.resolve('vite')
  const { createServer, isRunnableDevEnvironment } = await import(vitePath)

  const server = await createServer({
    configFile: resolve('vite.config.ts'),
    appType: 'custom',
    server: {
      middlewareMode: true,
      hmr: true,
    },
    environments: {
      // Only the SSR environment is needed for backend apps
      ssr: {},
    },
    // Filter out "(client)" warnings about node: modules being externalized
    customLogger: (() => {
      const { createLogger: createViteLogger } = require(vitePath)
      const logger = createViteLogger()
      const origWarn = logger.warn.bind(logger)
      logger.warn = (msg: string, options?: any) => {
        if (msg.includes('(client)') && msg.includes('externalized')) return
        origWarn(msg, options)
      }
      return logger
    })(),
  })

  const env = server.environments.ssr

  if (!isRunnableDevEnvironment(env)) {
    console.error(
      '\n  Error: Vite environment is not runnable.\n' +
        '  Ensure vite.config.ts uses the default SSR environment.\n',
    )
    process.exit(1)
  }

  console.log(`\n  KickJS dev server starting...`)
  console.log(`  Entry:  ${entry}`)
  console.log(`  HMR:    enabled (Vite Environment Runner)\n`)

  await env.runner.import(`/${entry}`)

  // Watch kick.config.ts for changes — restart the server on config edits
  const configFiles = ['kick.config.ts', 'kick.config.js', 'kick.config.mjs']
  for (const file of configFiles) {
    const configPath = resolve(file)
    server.watcher.add(configPath)
  }
  server.watcher.on('change', (path: string) => {
    const name = path.split('/').pop() ?? ''
    if (configFiles.includes(name)) {
      console.log(`\n  kick.config changed, restarting...\n`)
      server.restart()
    }
  })

  // Keep the process alive — the Express server is running
  // Graceful shutdown on SIGINT/SIGTERM
  const shutdown = async () => {
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
