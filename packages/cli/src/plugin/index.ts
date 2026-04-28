// Barrel intentionally omits `./builtins` — that module top-level-imports
// every register*Command, which pulls heavy modules (project scaffolders,
// fs reads at import time) into the graph. Importers that need the
// builtin list go through `./plugin/builtins` directly; tests + adopter
// plugins consuming only the contract types import from here.

export type { KickCliPlugin } from './types'
export { defineCliPlugin, KickPluginConflictError } from './types'
export { mergeCliPlugins, type MergedPlugins } from './merge'
