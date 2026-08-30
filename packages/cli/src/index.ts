// Generators
export { generateModule } from './generators/module'
export { generateAdapter } from './generators/adapter'
export { generateMiddleware } from './generators/middleware'
export { generateGuard } from './generators/guard'
export { generateService } from './generators/service'
export { generateController } from './generators/controller'
export { generateDto } from './generators/dto'
export { initProject } from './generators/project'

// Config
export { defineConfig, loadKickConfig } from './config'
export type { KickConfig, KickCommandDefinition, KickDbConfigBlock } from './config'
export { findProjectRoot } from './utils/project-root'

// CLI Plugin contract — adopters write `defineCliPlugin({...})` and add
// it to `kick.config.ts > plugins[]`. Built-in commands use the same
// shape internally.
export type { KickCliPlugin, KickCliPluginContext } from './plugin/types'
export { defineCliPlugin, KickPluginConflictError } from './plugin/types'

// Typegen plugin contract — passed via `KickCliPlugin.typegens`.
export type { TypegenPlugin, TypegenContext, TypegenPluginResult } from './typegen/plugin'
export { defineTypegen } from './typegen/plugin'

// Typegen-on-save engine — consumed by @forinda/kickjs-vite so plain
// `vite` boots get the same watcher `kick dev` wires (the CLI claims
// ownership via TYPEGEN_OWNER_KEY when it boots Vite itself).
export {
  createTypegenDevWatcher,
  TYPEGEN_OWNER_KEY,
  type TypegenDevWatcher,
  type TypegenDevWatcherOptions,
  type TypegenWatchEvent,
} from './typegen/dev-watcher'

// Plugin Generator Extension API (architecture.md §21.2.3)
// Plugins ship `kick g <name>` generators via `kickjs.generators` in
// their package.json — see `defineGenerator` for the manifest shape.
export {
  defineGenerator,
  buildGeneratorContext,
  type GeneratorContext,
  type GeneratorFile,
  type GeneratorSpec,
  type GeneratorArg,
  type GeneratorFlag,
  type DiscoveredGenerator,
  type DiscoveryResult,
} from './generator-extension'

// Doctor extension API — adopters and plugins ship custom dev-environment
// checks via `defineDoctorExtension({...})` and plug them through the
// `doctor.checks` block of kick.config.ts.
export {
  defineDoctorCheck,
  defineDoctorExtension,
  type DoctorCheck,
  type DoctorContext,
  type DoctorExtension,
  type DoctorResult,
} from './commands/doctor'

// Utilities
export { toPascalCase, toCamelCase, toKebabCase, pluralize } from './utils/naming'
