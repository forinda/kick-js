import { Command } from 'commander'
import { registerInitCommand } from './commands/init'
import { registerGenerateCommand } from './commands/generate'
import { registerRunCommands } from './commands/run'
import { registerInfoCommand } from './commands/info'
import { registerCustomCommands } from './commands/custom'
import { loadKickConfig } from './config'

async function main() {
  const program = new Command()

  program
    .name('kick')
    .description('KickJS — A production-grade, decorator-driven Node.js framework')
    .version('0.1.0')

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
