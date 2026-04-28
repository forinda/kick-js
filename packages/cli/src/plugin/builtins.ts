// Built-in CLI plugins — every command the kick CLI ships is expressed
// as a KickCliPlugin so the same merge + conflict-detection pipeline
// runs for built-ins and adopter plugins. Adding a new built-in command
// = append one entry here. Replacing one = drop the entry, ship a
// plugin with the same `name` from kick.config.ts.
//
// `register` is the programmatic-commander surface. We use it (not
// declarative `commands[]`) because every built-in needs full chain
// access (subcommands, options, async actions, etc.).

import { registerInitCommand } from '../commands/init'
import { registerGenerateCommand } from '../commands/generate'
import { registerRunCommands } from '../commands/run'
import { registerInfoCommand } from '../commands/info'
import { registerInspectCommand } from '../commands/inspect'
import { registerAddCommand, registerListCommand } from '../commands/add'
import { registerExplainCommand } from '../commands/explain'
import { registerMcpCommand } from '../commands/mcp'
import { registerTinkerCommand } from '../commands/tinker'
import { registerRemoveCommand } from '../commands/remove'
import { registerTypegenCommand } from '../commands/typegen'
import { registerCheckCommand } from '../commands/check'
import { registerDbCommands } from '../commands/db'
import { kickDbTypegen } from '../typegen/builtin/db'
import { kickAssetsTypegen } from '../typegen/builtin/assets'

import { defineCliPlugin, type KickCliPlugin } from './types'

export const builtinCliPlugins: readonly KickCliPlugin[] = [
  defineCliPlugin({ name: 'kick/init', register: registerInitCommand }),
  defineCliPlugin({ name: 'kick/generate', register: registerGenerateCommand }),
  defineCliPlugin({ name: 'kick/run', register: registerRunCommands }),
  defineCliPlugin({ name: 'kick/info', register: registerInfoCommand }),
  defineCliPlugin({ name: 'kick/inspect', register: registerInspectCommand }),
  defineCliPlugin({ name: 'kick/add', register: registerAddCommand }),
  defineCliPlugin({ name: 'kick/list', register: registerListCommand }),
  defineCliPlugin({ name: 'kick/explain', register: registerExplainCommand }),
  defineCliPlugin({ name: 'kick/mcp', register: registerMcpCommand }),
  defineCliPlugin({ name: 'kick/tinker', register: registerTinkerCommand }),
  defineCliPlugin({ name: 'kick/remove', register: registerRemoveCommand }),
  defineCliPlugin({ name: 'kick/typegen', register: registerTypegenCommand }),
  defineCliPlugin({ name: 'kick/check', register: registerCheckCommand }),
  defineCliPlugin({ name: 'kick/db', register: registerDbCommands, typegens: [kickDbTypegen()] }),
  // kick/assets is typegen-only — the asset manager itself is wired
  // via @forinda/kickjs runtime, not the CLI. M2.B-T8 carved it out
  // first (smallest legacy section, cleanest extraction). Routes/env
  // follow once their generator-side `import` strategies move to the
  // inline `import('...')` shape that .d.ts files tolerate.
  defineCliPlugin({ name: 'kick/assets', typegens: [kickAssetsTypegen()] }),
]
