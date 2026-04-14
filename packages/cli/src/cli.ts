import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerInitCommand } from './commands/init'
import { registerGenerateCommand } from './commands/generate'
import { registerRunCommands } from './commands/run'
import { registerInfoCommand } from './commands/info'
import { registerCustomCommands } from './commands/custom'
import { registerInspectCommand } from './commands/inspect'
import { registerAddCommand, registerListCommand } from './commands/add'
import { registerExplainCommand } from './commands/explain'
import { registerMcpCommand } from './commands/mcp'
import { registerTinkerCommand } from './commands/tinker'
import { registerRemoveCommand } from './commands/remove'
import { registerTypegenCommand } from './commands/typegen'
import { registerCheckCommand } from './commands/check'
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
  registerInspectCommand(program)
  registerAddCommand(program)
  registerListCommand(program)
  registerExplainCommand(program)
  registerMcpCommand(program)
  registerTinkerCommand(program)
  registerRemoveCommand(program)
  registerTypegenCommand(program)
  registerCheckCommand(program)
  registerCustomCommands(program, config)

  program.showHelpAfterError()

  await program.parseAsync(process.argv)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
