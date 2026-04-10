import { resolve, join } from 'node:path'
import { pluralize, toKebabCase } from './naming'
import type { ProjectPattern } from '../config'

/**
 * DDD folder mapping — nested layered architecture.
 */
const DDD_FOLDER_MAP: Record<string, string> = {
  controller: 'presentation',
  service: 'domain/services',
  dto: 'application/dtos',
  guard: 'presentation/guards',
  middleware: 'middleware',
}

/**
 * Flat folder mapping — REST/GraphQL/minimal patterns.
 * Files live at the module root or in minimal subdirectories.
 */
const FLAT_FOLDER_MAP: Record<string, string> = {
  controller: '',
  service: '',
  dto: 'dtos',
  guard: 'guards',
  middleware: 'middleware',
}

/**
 * CQRS folder mapping — commands, queries, events.
 */
const CQRS_FOLDER_MAP: Record<string, string> = {
  controller: '',
  service: '',
  dto: 'dtos',
  guard: 'guards',
  middleware: 'middleware',
  command: 'commands',
  query: 'queries',
  event: 'events',
}

export interface ResolveOutDirOptions {
  /** The artifact type (controller, service, dto, guard, middleware) */
  type: string
  /** Explicit -o / --out dir from CLI flag (takes highest priority) */
  outDir?: string
  /** Module name from --module flag */
  moduleName?: string
  /** Modules directory (from config or default) */
  modulesDir?: string
  /** Standalone default directory when no --module is used (e.g. 'src/controllers') */
  defaultDir: string
  /** Project pattern — determines folder structure inside modules */
  pattern?: ProjectPattern
  /** Whether to pluralize the module folder name (default: true) */
  shouldPluralize?: boolean
}

/**
 * Resolve the output directory for a generator artifact.
 *
 * Priority:
 *   1. Explicit --out flag (always wins)
 *   2. --module flag → maps into module's folder (DDD or flat based on pattern)
 *   3. Standalone default directory
 */
export function resolveOutDir(options: ResolveOutDirOptions): string {
  const {
    type,
    outDir,
    moduleName,
    modulesDir = 'src/modules',
    defaultDir,
    pattern = 'ddd',
    shouldPluralize = true,
  } = options

  // Explicit --out always wins
  if (outDir) return resolve(outDir)

  // Module-scoped: place inside the module's folder
  if (moduleName) {
    const folderMap =
      pattern === 'ddd' ? DDD_FOLDER_MAP : pattern === 'cqrs' ? CQRS_FOLDER_MAP : FLAT_FOLDER_MAP
    const kebab = toKebabCase(moduleName)
    const folder = shouldPluralize ? pluralize(kebab) : kebab
    const subfolder = folderMap[type] ?? ''
    const base = join(modulesDir, folder)
    return resolve(subfolder ? join(base, subfolder) : base)
  }

  // Standalone default
  return resolve(defaultDir)
}
