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
import { registerDoctorCommand } from '../commands/doctor'
import { registerCodemodCommands } from '../commands/codemod'
import { kickAssetsTypegen } from '../typegen/builtin/assets'
import { kickRoutesTypegen } from '../typegen/builtin/routes'
import { kickEnvTypegen } from '../typegen/builtin/env'
import { kickRegistryTypegen } from '../typegen/builtin/registry'
import { kickServiceTokensTypegen } from '../typegen/builtin/service-tokens'
import { kickModuleTokensTypegen } from '../typegen/builtin/module-tokens'
import { kickPluginsRegistryTypegen } from '../typegen/builtin/plugins-registry'
import { kickAugmentationsTypegen } from '../typegen/builtin/augmentations'
import { kickContextTypegen } from '../typegen/builtin/context'

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
  defineCliPlugin({ name: 'kick/doctor', register: registerDoctorCommand }),
  // The `kick/db` commands AND its `.kickjs/types` generation both ship
  // from `@forinda/kickjs-db/cli` as the opt-in `dbCliPlugin` — add it to
  // `kick.config.ts` `plugins: []`.
  defineCliPlugin({ name: 'kick/codemod', register: registerCodemodCommands }),
  // Typegen-only built-ins. Each owns one `.kickjs/types/kick__*` file
  // via the TypegenPlugin contract; together they replace the entire
  // legacy `typegen/generator.ts` monolith (now removed). The asset
  // manager runtime itself is wired via @forinda/kickjs, not the CLI.
  //
  // Registration order is the emission order. registry/services/modules
  // run first (they were the generator's core output), then the carved
  // plugins. Order is not load-bearing for correctness — the runner
  // isolates each plugin — but keeps log output stable.
  defineCliPlugin({ name: 'kick/registry', typegens: [kickRegistryTypegen()] }),
  defineCliPlugin({ name: 'kick/services', typegens: [kickServiceTokensTypegen()] }),
  defineCliPlugin({ name: 'kick/modules', typegens: [kickModuleTokensTypegen()] }),
  defineCliPlugin({ name: 'kick/plugins', typegens: [kickPluginsRegistryTypegen()] }),
  defineCliPlugin({ name: 'kick/augmentations', typegens: [kickAugmentationsTypegen()] }),
  defineCliPlugin({ name: 'kick/context', typegens: [kickContextTypegen()] }),
  defineCliPlugin({ name: 'kick/assets', typegens: [kickAssetsTypegen()] }),
  defineCliPlugin({ name: 'kick/routes', typegens: [kickRoutesTypegen()] }),
  defineCliPlugin({ name: 'kick/env', typegens: [kickEnvTypegen()] }),
]
