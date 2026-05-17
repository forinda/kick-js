import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerCustomCommands } from './commands/custom'
import { loadKickConfig, type KickConfig } from './config'
import { mergeCliPlugins } from './plugin'
import { builtinCliPlugins } from './plugin/builtins'
import { findProjectRoot } from './utils/project-root'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))

async function main() {
  const program = new Command()

  program
    .name('kick')
    .description('KickJS — A production-grade, decorator-driven Node.js framework')
    .version(pkg.version)

  // Walk up to find the project root — `kick` invoked from any
  // subdirectory (e.g. `src/modules/users/`) still resolves the
  // adopter's kick.config.* + plugins instead of silently falling
  // back to defaults.
  const cwd = findProjectRoot(process.cwd())

  // Default to {} so spreads + the `commands`/`plugins` reads stay
  // safe when the adopter has no kick.config.ts. The cast keeps the
  // shape downstream — `loadKickConfig` returns `KickConfig | null`,
  // we just substitute an empty config object instead of branching at
  // every use site.
  const config = (await loadKickConfig(cwd)) ?? ({} as KickConfig)

  // Compose built-ins + user plugins into a single pipeline. Conflict
  // detection on plugin name / command name / typegen id runs here —
  // a clashing user plugin fails fast before any command touches argv.
  const allPlugins = [...builtinCliPlugins, ...(config.plugins ?? [])]
  const merged = mergeCliPlugins(allPlugins, config.commands ?? [])

  await merged.register(program, {
    cwd,
    config,
    log: (msg) => console.log(msg),
  })

  // Adopter declarative commands (kick.config.ts `commands`) + plugin
  // declarative commands flow through registerCustomCommands. The
  // merge already filtered adopter overrides, so this list is the
  // resolved view.
  registerCustomCommands(program, { ...config, commands: merged.commands })

  program.showHelpAfterError()

  await program.parseAsync(process.argv)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
