import { resolve } from 'node:path'
import type { Command } from 'commander'

/**
 * `kick tinker` — Interactive REPL with DI container loaded.
 *
 * Boots the KickJS application (without starting the HTTP server),
 * then drops into a Node REPL with the container and all registered
 * services available.
 *
 * Usage:
 *   kick tinker                    # Default: loads src/index.ts
 *   kick tinker --entry src/app.ts # Custom entry point
 *
 * Inside the REPL:
 *   > container.resolve(UserService)
 *   > const users = container.resolve(UserRepository)
 *   > await users.findAll()
 */
export function registerTinkerCommand(program: Command): void {
  program
    .command('tinker')
    .description('Interactive REPL with DI container and services loaded')
    .option('-e, --entry <file>', 'Entry file to load', 'src/index.ts')
    .action(async (opts: any) => {
      const entryPath = resolve(opts.entry)

      console.log(`\n  🔧 KickJS Tinker`)
      console.log(`  Loading: ${opts.entry}\n`)

      try {
        // Dynamically import the app entry to trigger decorator registration
        // We use tsx/vite-node at runtime, so TS imports work
        await importEntry(entryPath)
      } catch (err: any) {
        if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
          console.error(`  Error: Could not find ${opts.entry}`)
          console.error(`  Make sure the file exists and your project is set up.\n`)
          process.exit(1)
        }
        // Non-fatal: some apps may fail to fully boot without a DB, etc.
        console.warn(`  Warning: Entry loaded with errors: ${err.message}`)
        console.warn(`  Container may be partially initialized.\n`)
      }

      // Get the container
      let Container: any
      try {
        const core = await import('@forinda/kickjs-core')
        Container = core.Container
      } catch {
        console.error('  Error: @forinda/kickjs-core not found. Is it installed?\n')
        process.exit(1)
      }

      const container = Container.getInstance()

      // Start REPL
      const repl = await import('node:repl')
      const server = repl.start({
        prompt: 'kick> ',
        useGlobal: true,
      })

      // Inject helpers into REPL context
      server.context.container = container
      server.context.Container = Container
      server.context.resolve = (token: any) => container.resolve(token)

      // Try to make commonly used exports available
      try {
        const core = await import('@forinda/kickjs-core')
        Object.assign(server.context, {
          Service: core.Service,
          Inject: core.Inject,
          Logger: core.Logger,
          HttpException: core.HttpException,
          HttpStatus: core.HttpStatus,
        })
      } catch {
        // Non-critical
      }

      console.log('  Available globals:')
      console.log('    container    — DI container instance')
      console.log('    resolve(T)   — shorthand for container.resolve(T)')
      console.log('    Container    — Container class (for .reset(), etc.)')
      console.log('    Logger, HttpException, HttpStatus')
      console.log()

      server.on('exit', () => {
        console.log('\n  Goodbye!\n')
        process.exit(0)
      })
    })
}

async function importEntry(entryPath: string): Promise<void> {
  // Try native ESM import first (works with tsx, vite-node, ts-node/esm)
  try {
    await import(entryPath)
    return
  } catch (err: any) {
    // If it's a TS file and native import failed, try with tsx
    if (entryPath.endsWith('.ts')) {
      try {
        // tsx registers itself as a loader
        const { register } = await import('node:module')
        if (typeof register === 'function') {
          register('tsx/esm', import.meta.url)
          await import(entryPath)
          return
        }
      } catch {
        // Fall through
      }
    }
    throw err
  }
}
