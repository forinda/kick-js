import { existsSync } from 'node:fs'
import { readFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'

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

/** Package manager used for `kick add` and other dep-installing commands */
export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export const PACKAGE_MANAGERS: readonly PackageManager[] = ['pnpm', 'npm', 'yarn', 'bun']

/** Built-in repository types with first-class code generation support */
export type BuiltinRepoType = 'drizzle' | 'inmemory' | 'prisma'

export const BUILTIN_REPO_TYPES: readonly string[] = ['drizzle', 'inmemory', 'prisma']

/** Custom repository type — generates a stub with TODO markers */
export interface CustomRepoType {
  name: string
}

/** Repository type — built-in string or custom object */
export type RepoTypeConfig = BuiltinRepoType | CustomRepoType

/**
 * Supported schema validators for `kick typegen` body/query/params
 * type extraction. Only `'zod'` ships built-in for now; other libraries
 * (Joi, Yup, JSON Schema) will be added later as the adapter system
 * grows. Set to `false` (or omit) to disable schema-driven body typing
 * entirely (the route entries will keep `body: unknown`).
 */
export type SchemaValidator = 'zod' | false

/**
 * One entry in the typed `assetMap` config record (`assets-plan.md`).
 * Each entry names a source directory whose files become addressable
 * via the `assets.<name>.*` typed accessor at runtime.
 */
export interface AssetMapEntry {
  /**
   * Source directory, relative to project root. Required. The directory
   * must exist when `kick build` runs — `loadKickConfig` warns when an
   * entry points at a missing directory but doesn't fail the load
   * (the typegen + build steps surface the error in context instead).
   */
  src: string
  /**
   * Destination directory inside `dist/`. Defaults to `dist/<name>/`
   * where `<name>` is the assetMap key. Override when the consumer of
   * the assets expects a non-standard layout (e.g. an existing
   * downstream tool reads from `dist/templates/...`).
   */
  dest?: string
  /**
   * Glob pattern for which files to include. Defaults to `**\/*` (all
   * files). Files that don't match are NOT copied — `assetMap` is
   * selective by design (unlike `copyDirs` which copies everything).
   */
  glob?: string
}

/** Typegen settings — controls .kickjs/types/* generation */
export interface TypegenConfig {
  /**
   * Source directory to scan for controllers and decorators.
   * Defaults to `'src'`.
   */
  srcDir?: string
  /**
   * Output directory for generated `.d.ts` files.
   * Defaults to `'.kickjs/types'`.
   */
  outDir?: string
  /**
   * Schema validator used to derive `body` types from route metadata.
   *
   * - `'zod'` — emit `z.infer<typeof <importedSchema>>` for any schema
   *   referenced as a named identifier in `@Get/@Post/...({ body, query, params })`.
   * - `false` — disable schema-driven body typing.
   *
   * Future: `'joi' | 'yup' | 'json-schema'` plus a `{ name; module }`
   * escape hatch for custom adapters.
   *
   * @default 'zod'
   */
  schemaValidator?: SchemaValidator
  /**
   * Path to the project's env schema file (relative to project root).
   * Must default-export a `defineEnv(...)` schema for typegen to emit
   * the typed `KickEnv` global registry.
   *
   * Set to `false` to disable env typing entirely.
   *
   * @default 'src/env.ts'
   */
  envFile?: string | false
}

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
  /**
   * Import path for the Prisma generated client in `--repo prisma` templates.
   * Must resolve within `src/` for path alias compatibility.
   *
   * @default '@prisma/client' (Prisma 5/6)
   * @example
   * prismaClientPath: '@/generated/prisma/client'  // Prisma 7+
   * prismaClientPath: './generated/prisma/client'   // relative
   */
  prismaClientPath?: string
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
  /**
   * Package manager used by `kick add` (and any future dep-installing command)
   * to install dependencies. When set, overrides lockfile auto-detection so
   * commands always use the project's intended package manager.
   *
   * Priority (highest first):
   * 1. `--pm` flag on the CLI
   * 2. `packageManager` in kick.config
   * 3. `packageManager` field in package.json (corepack convention)
   * 4. Lockfile detection (pnpm-lock.yaml → pnpm, yarn.lock → yarn)
   * 5. `'npm'`
   *
   * @example
   * packageManager: 'pnpm'
   */
  packageManager?: PackageManager

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
  /**
   * Build output settings. The asset manager + `kick build`'s copy
   * steps honour these — adopters who use Vite's `build.outDir =
   * 'out'` (or any non-default) should mirror the value here so
   * `assets.x.y()` paths line up with where Vite actually wrote.
   *
   * @example
   * ```ts
   * build: { outDir: 'out' }
   * ```
   */
  build?: {
    /**
     * Output directory, relative to project root. Defaults to
     * `'dist'`. The asset manager emits its manifest + copies
     * assetMap entries into this directory (under a per-namespace
     * subdirectory by default; override per-entry via `dest`).
     */
    outDir?: string
  }
  /**
   * Typed, addressable assets — see `assets-plan.md`. Each entry maps
   * a logical namespace name to a source directory. The build pipeline
   * auto-derives the necessary copy step + emits a manifest at
   * `dist/.kickjs-assets.json`; the runtime exposes
   * `import { assets } from '@forinda/kickjs'` so adopters can resolve
   * paths without dev/prod branching.
   *
   * `copyDirs` is unchanged — `assetMap` is a separate, opt-in surface.
   * Adopters who want raw directory copies keep using `copyDirs`; those
   * who want typed addressable assets add `assetMap` entries.
   *
   * @example
   * ```ts
   * assetMap: {
   *   mails: { src: 'src/templates/mails' },
   *   reports: { src: 'src/templates/reports', glob: '**\/*.{ejs,html}' },
   *   schemas: { src: 'src/schemas', glob: '**\/*.json' },
   * }
   * ```
   */
  assetMap?: Record<string, AssetMapEntry>
  /**
   * Typegen settings — controls `.kickjs/types/*` generation including
   * the schema validator used for body type extraction.
   *
   * @example
   * ```ts
   * typegen: {
   *   schemaValidator: 'zod',
   * }
   * ```
   */
  typegen?: TypegenConfig
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
  const mc: ModuleConfig = {
    dir: config.modules?.dir ?? config.modulesDir,
    repo: config.modules?.repo ?? config.defaultRepo,
    schemaDir: config.modules?.schemaDir ?? config.schemaDir,
    pluralize: config.modules?.pluralize ?? config.pluralize,
    prismaClientPath: config.modules?.prismaClientPath,
  }

  // Warn if a string repo value isn't a known built-in
  if (mc.repo && typeof mc.repo === 'string' && !BUILTIN_REPO_TYPES.includes(mc.repo)) {
    console.warn(
      `  Warning: modules.repo '${mc.repo}' is not a built-in type (${BUILTIN_REPO_TYPES.join(', ')}).` +
        ` It will generate a stub repository. Use { name: '${mc.repo}' } to silence this warning.`,
    )
  }

  return mc
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
      const config = (mod.default ?? mod) as KickConfig
      // Surface assetMap mistakes at config-load time so they aren't
      // hidden inside the build pipeline. Warnings only — a typo
      // shouldn't block `kick g`, `kick typegen`, etc.
      const warnings = validateAssetMap(config, cwd)
      for (const warning of warnings) console.warn(`  Warning: ${warning}`)
      return config
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

/**
 * Validate `assetMap` entries on a loaded config. Returns a list of
 * human-readable warnings; the caller decides how to surface them
 * (typically `console.warn`). Never throws — `kick g` and other
 * unrelated commands should keep working even when the assetMap is
 * misconfigured.
 *
 * Checks:
 *
 * - Each entry's `src` is a non-empty string.
 * - The `src` directory exists on disk (otherwise the typegen + build
 *   steps will fail later with cryptic errors).
 * - `dest` doesn't escape the project root (defensive — a `dest:
 *   '../../etc'` typo could write files outside the workspace).
 * - The namespace key is a non-empty string and doesn't include a
 *   `/` (would conflict with the `<namespace>/<key>` manifest format).
 */
export function validateAssetMap(config: KickConfig | null, cwd: string): string[] {
  const warnings: string[] = []
  if (!config?.assetMap) return warnings

  const root = resolve(cwd)
  for (const [namespace, entry] of Object.entries(config.assetMap)) {
    if (!namespace || namespace.includes('/')) {
      warnings.push(
        `assetMap key '${namespace}' is invalid — must be a non-empty string without '/'`,
      )
      continue
    }
    if (typeof entry?.src !== 'string' || entry.src.length === 0) {
      warnings.push(`assetMap.${namespace} is missing a non-empty 'src' field`)
      continue
    }
    const srcAbs = resolve(cwd, entry.src)
    if (!existsSync(srcAbs)) {
      warnings.push(
        `assetMap.${namespace}.src ('${entry.src}') does not exist — typegen + build will fail`,
      )
    }
    if (entry.dest) {
      const destAbs = resolve(cwd, entry.dest)
      if (!destAbs.startsWith(root)) {
        warnings.push(
          `assetMap.${namespace}.dest ('${entry.dest}') resolves outside the project root — refusing to copy`,
        )
      }
    }
  }
  return warnings
}
