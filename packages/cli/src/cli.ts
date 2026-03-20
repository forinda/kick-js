import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerInitCommand } from './commands/init'
import { registerGenerateCommand } from './commands/generate'
import { registerRunCommands } from './commands/run'
import { registerInfoCommand } from './commands/info'
import { registerCustomCommands } from './commands/custom'
import { loadKickConfig } from './config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))

async function main() {
  const program = new Command()

  program
    .name('kick')
    .description('KickJS — A production-grade, decorator-driven Node.js framework')
    .version(pkg.version)

  // Load project-level config for custom commands and generator defaults
  const config = await loadKickConfig(process.cwd())

  registerInitCommand(program)
  registerGenerateCommand(program)
  registerRunCommands(program)
  registerInfoCommand(program)
  registerCustomCommands(program, config)

  program.showHelpAfterError()

  await program.parseAsync(process.argv)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
