import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

/** A custom command that developers can register via kick.config.ts */
export interface KickCommandDefinition {
  /** The command name (e.g. 'db:migrate', 'seed', 'proto:gen') */
  name: string
  /** Description shown in --help */
  description: string
  /**
   * Shell command(s) to run. Can be a single string or an array of
   * sequential steps. Use {args} as a placeholder for CLI arguments.
   *
   * @example
   * 'npx drizzle-kit migrate'
   * ['npx drizzle-kit generate', 'npx drizzle-kit migrate']
   */
  steps: string | string[]
  /** Optional aliases (e.g. ['migrate'] for 'db:migrate') */
  aliases?: string[]
}

/** Project pattern — controls what generators produce and which deps are installed */
export type ProjectPattern = 'rest' | 'graphql' | 'ddd' | 'cqrs' | 'minimal'

/** Built-in repository types with first-class code generation support */
export type BuiltinRepoType = 'drizzle' | 'inmemory' | 'prisma'

/** Custom repository type — generates a stub with TODO markers */
export interface CustomRepoType {
  name: string
}

/** Repository type — built-in string or custom object */
export type RepoTypeConfig = BuiltinRepoType | CustomRepoType

/** Module generation settings — controls how `kick g module` produces code */
export interface ModuleConfig {
  /** Where modules live (default: 'src/modules') */
  dir?: string
  /**
   * Default repository implementation for generators.
   *
   * Built-in types (string): `'drizzle'`, `'inmemory'`, `'prisma'`
   * — generate fully working repository code.
   *
   * Custom types (object): `{ name: 'typeorm' }`
   * — generate a stub repository with TODO markers.
   *
   * @example
   * repo: 'prisma'                // built-in
   * repo: { name: 'typeorm' }     // custom
   */
  repo?: RepoTypeConfig
  /** Schema output directory (e.g. 'src/db/schema' for Drizzle, 'prisma/' for Prisma) */
  schemaDir?: string
  /**
   * Whether to pluralize module names in generated code.
   * When true (default), `kick g module user` creates `src/modules/users/`.
   * When false, it creates `src/modules/user/` and uses singular names throughout.
   */
  pluralize?: boolean
}

/** Configuration for the kick.config.ts file */
export interface KickConfig {
  /**
   * Project pattern — controls default generator behavior.
   * - 'rest' — Express + Swagger (default)
   * - 'graphql' — GraphQL + GraphiQL
   * - 'ddd' — Full DDD modules with use cases, entities, value objects
   * - 'cqrs' — CQRS with commands, queries, events, WebSocket + queue
   * - 'minimal' — Bare Express with no scaffolding
   */
  pattern?: ProjectPattern
  /**
   * Module generation settings — directory, repo type, pluralization, schema dir.
   *
   * @example
   * modules: {
   *   dir: 'src/modules',
   *   repo: 'prisma',
   *   pluralize: false,
   *   schemaDir: 'prisma/',
   * }
   */
  modules?: ModuleConfig

  // ── Backward-compatible top-level aliases (deprecated, use modules.* instead) ──
  /** @deprecated Use `modules.dir` instead */
  modulesDir?: string
  /** @deprecated Use `modules.repo` instead */
  defaultRepo?: RepoTypeConfig
  /** @deprecated Use `modules.schemaDir` instead */
  schemaDir?: string
  /** @deprecated Use `modules.pluralize` instead */
  pluralize?: boolean
  /**
   * Directories to copy to dist/ after build.
   * Useful for EJS templates, email templates, static assets, etc.
   *
   * @example
   * ```ts
   * copyDirs: [
   *   'src/views',                          // copies to dist/src/views
   *   { src: 'src/views', dest: 'dist/views' }, // custom dest
   *   'src/emails',
   * ]
   * ```
   */
  copyDirs?: Array<string | { src: string; dest?: string }>
  /** Custom commands that extend the CLI */
  commands?: KickCommandDefinition[]
  /** Code style overrides (auto-detected from prettier when possible) */
  style?: {
    semicolons?: boolean
    quotes?: 'single' | 'double'
    trailingComma?: 'all' | 'es5' | 'none'
    indent?: number
  }
}

/** Helper to define a type-safe kick.config.ts */
export function defineConfig(config: KickConfig): KickConfig {
  return config
}

/** Resolve module config with backward-compatible fallbacks from top-level fields */
export function resolveModuleConfig(config: KickConfig | null): ModuleConfig {
  if (!config) return {}
  return {
    dir: config.modules?.dir ?? config.modulesDir,
    repo: config.modules?.repo ?? config.defaultRepo,
    schemaDir: config.modules?.schemaDir ?? config.schemaDir,
    pluralize: config.modules?.pluralize ?? config.pluralize,
  }
}

const CONFIG_FILES = ['kick.config.ts', 'kick.config.js', 'kick.config.mjs', 'kick.config.json']

/** Load kick.config.* from the project root */
export async function loadKickConfig(cwd: string): Promise<KickConfig | null> {
  for (const filename of CONFIG_FILES) {
    const filepath = join(cwd, filename)
    try {
      await access(filepath)
    } catch {
      continue
    }

    if (filename.endsWith('.json')) {
      const content = await readFile(filepath, 'utf-8')
      return JSON.parse(content)
    }

    // For .ts/.js/.mjs — dynamic import (use file URL for cross-platform compat)
    try {
      const { pathToFileURL } = await import('node:url')
      const mod = await import(pathToFileURL(filepath).href)
      return mod.default ?? mod
    } catch (err) {
      if (filename.endsWith('.ts')) {
        console.warn(
          `Warning: Failed to load ${filename}. TypeScript config files require ` +
            'a runtime loader (e.g. tsx, ts-node) or use kick.config.js/.mjs instead.',
        )
      }
      continue
    }
  }
  return null
}
