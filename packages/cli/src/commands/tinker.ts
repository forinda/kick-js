import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { fork } from 'node:child_process'
import type { Command } from 'commander'

export function registerTinkerCommand(program: Command): void {
  program
    .command('tinker')
    .description('Interactive REPL with DI container and services loaded')
    .option('-e, --entry <file>', 'Entry file to load', 'src/index.ts')
    .action(async (opts: any) => {
      const cwd = process.cwd()
      const entryPath = resolve(cwd, opts.entry)

      if (!existsSync(entryPath)) {
        console.error(`\n  Error: ${opts.entry} not found.\n`)
        process.exit(1)
      }

      // Find tsx for TypeScript + decorator support
      const tsxBin = findBin(cwd, 'tsx')
      if (!tsxBin) {
        console.error('\n  Error: tsx not found. Install it: pnpm add -D tsx\n')
        process.exit(1)
      }

      // Write a temporary tinker script that loads the app and starts REPL
      const tinkerScript = generateTinkerScript(entryPath, opts.entry)
      const tmpFile = join(cwd, '.kick-tinker.mjs')

      const { writeFileSync, unlinkSync } = await import('node:fs')
      writeFileSync(tmpFile, tinkerScript, 'utf-8')

      try {
        // Run the tinker script under tsx (inherits stdio for interactive REPL)
        const child = fork(tmpFile, [], {
          cwd,
          execPath: tsxBin,
          stdio: 'inherit',
        })

        await new Promise<void>((resolve) => {
          child.on('exit', () => resolve())
        })
      } finally {
        // Clean up temp file
        try {
          unlinkSync(tmpFile)
        } catch {
          // ignore
        }
      }
    })
}

function generateTinkerScript(entryPath: string, displayPath: string): string {
  const entryUrl = pathToFileURL(entryPath).href

  return `
import 'reflect-metadata'

// Prevent bootstrap() from starting the HTTP server
process.env.KICK_TINKER = '1'

console.log('\\n  🔧 KickJS Tinker')
console.log('  Loading: ${displayPath}\\n')

// Load core
let Container, Logger, HttpException, HttpStatus
try {
  const core = await import('@forinda/kickjs')
  Container = core.Container
  Logger = core.Logger
  HttpException = core.HttpException
  HttpStatus = core.HttpStatus
} catch {
  console.error('  Error: @forinda/kickjs not found.')
  console.error('  Install it: pnpm add @forinda/kickjs\\n')
  process.exit(1)
}

// Load entry to trigger decorator registration
try {
  await import('${entryUrl}')
} catch (err) {
  console.warn('  Warning: ' + err.message)
  console.warn('  Container may be partially initialized.\\n')
}

const container = Container.getInstance()

// Start REPL
const repl = await import('node:repl')
const server = repl.start({ prompt: 'kick> ', useGlobal: true })

server.context.container = container
server.context.Container = Container
server.context.resolve = (token) => container.resolve(token)
server.context.Logger = Logger
server.context.HttpException = HttpException
server.context.HttpStatus = HttpStatus

console.log('  Available globals:')
console.log('    container    — DI container instance')
console.log('    resolve(T)   — shorthand for container.resolve(T)')
console.log('    Container, Logger, HttpException, HttpStatus')
console.log()

server.on('exit', () => {
  console.log('\\n  Goodbye!\\n')
  process.exit(0)
})
`
}

function findBin(startDir: string, name: string): string | null {
  let dir = startDir
  while (true) {
    const candidate = join(dir, 'node_modules', '.bin', name)
    if (existsSync(candidate)) return candidate
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}
