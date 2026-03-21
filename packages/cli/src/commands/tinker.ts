import { resolve, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
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
      const cwd = process.cwd()
      const entryPath = resolve(cwd, opts.entry)

      console.log(`\n  🔧 KickJS Tinker`)
      console.log(`  Loading: ${opts.entry}\n`)

      // Resolve @forinda/kickjs-core from the user's project
      const corePath = findPackage(cwd, '@forinda/kickjs-core')
      if (!corePath) {
        console.error('  Error: @forinda/kickjs-core not found in this project.')
        console.error('  Install it: pnpm add @forinda/kickjs-core\n')
        process.exit(1)
      }

      const core: any = await import(pathToFileURL(corePath).href)
      const Container = core.Container

      // Try to load the entry file to trigger decorator registration
      try {
        await import(pathToFileURL(entryPath).href)
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

      // Add commonly used core exports
      if (core.Logger) server.context.Logger = core.Logger
      if (core.HttpException) server.context.HttpException = core.HttpException
      if (core.HttpStatus) server.context.HttpStatus = core.HttpStatus
      if (core.Service) server.context.Service = core.Service
      if (core.Inject) server.context.Inject = core.Inject

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

/**
 * Find a package in the project's node_modules, walking up directories.
 * Returns the absolute path to the package directory, or null if not found.
 */
/**
 * Find a package in the project's node_modules, walking up directories.
 * Returns the absolute path to the package's ESM entry file, or null if not found.
 */
function findPackage(startDir: string, packageName: string): string | null {
  let dir = startDir
  while (true) {
    const candidate = join(dir, 'node_modules', packageName)
    const pkgJsonPath = join(candidate, 'package.json')
    if (existsSync(pkgJsonPath)) {
      // Read package.json to find the ESM entry point
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
      // Resolve: exports["."].import > main > index.js
      const entry =
        pkgJson.exports?.['.']?.import ?? pkgJson.exports?.['.'] ?? pkgJson.main ?? 'index.js'
      return join(candidate, entry)
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}
