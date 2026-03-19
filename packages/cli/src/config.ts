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

/** Configuration for the kick.config.ts file */
export interface KickConfig {
  /** Where modules live (default: 'src/modules') */
  modulesDir?: string
  /** Default repository implementation for generators */
  defaultRepo?: 'drizzle' | 'inmemory' | 'prisma'
  /** Drizzle schema output directory */
  schemaDir?: string
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
    } catch {
      // If ts import fails, skip
      continue
    }
  }
  return null
}
