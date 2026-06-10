// CLI plugin contract — re-exported from `@forinda/kickjs-cli-kit`.
//
// The contract itself (defineCliPlugin, KickCliPlugin, the context, the
// generator + command types) lives in the dependency-free
// `@forinda/kickjs-cli-kit` so packages can ship CLI commands without
// depending on `@forinda/kickjs-cli` (which would cycle — the CLI depends
// on those packages). This module re-exports it for back-compat (adopters
// import `defineCliPlugin` from `@forinda/kickjs-cli`) and narrows the
// host-config generic to the CLI's `KickConfig`.

import type { KickConfig } from '../config'
import {
  type KickCliPlugin as KitCliPlugin,
  type KickCliPluginContext as KitCliPluginContext,
} from '@forinda/kickjs-cli-kit'

// Re-export the contract verbatim so `import { defineCliPlugin } from
// '@forinda/kickjs-cli'` keeps working.
export {
  defineCliPlugin,
  KickPluginConflictError,
  type KickCommandDefinition,
  type CliTypegen,
  type DiscoveredGenerator,
  type GeneratorSpec,
  type GeneratorContext,
  type GeneratorFile,
  type GeneratorArg,
  type GeneratorFlag,
  defineGenerator,
} from '@forinda/kickjs-cli-kit'

/** CLI plugin context with the host config narrowed to `KickConfig`. */
export type KickCliPluginContext = KitCliPluginContext<KickConfig>

/** A CLI plugin with the host config narrowed to `KickConfig`. */
export type KickCliPlugin = KitCliPlugin<KickConfig>
