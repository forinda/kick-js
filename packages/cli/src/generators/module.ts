import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { writeFileSafe, fileExists } from '../utils/fs'
import { toPascalCase, toKebabCase, pluralize, pluralizePascal } from '../utils/naming'
import { readFile, writeFile } from 'node:fs/promises'
import type { ProjectPattern, RepoTypeConfig } from '../config'
import {
  generateMinimalFiles,
  generateRestFiles,
  generateCqrsFiles,
  generateDddFiles,
} from './patterns'
import type { ModuleContext } from './patterns'

export type BuiltinRepoType = 'drizzle' | 'inmemory' | 'prisma'
export type RepoType = BuiltinRepoType | (string & {})

/** Resolve a RepoTypeConfig (from kick.config.ts) into a flat repo type string */
export function resolveRepoType(config?: RepoTypeConfig): RepoType {
  if (!config) return 'inmemory'
  if (typeof config === 'string') return config
  return config.name
}

interface GenerateModuleOptions {
  name: string
  modulesDir: string
  noEntity?: boolean
  noTests?: boolean
  repo?: RepoType
  minimal?: boolean
  force?: boolean
  pattern?: ProjectPattern
  dryRun?: boolean
  /** When false, skip pluralization — use singular names for folders, routes, and classes */
  pluralize?: boolean
  /** Prisma client import path (default: '@prisma/client', Prisma 7+: '@/generated/prisma/client') */
  prismaClientPath?: string
}

/** Prompt the user for a single-line answer via stdin */
function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase())
    })
  })
}

/**
 * Generate a module — structure depends on the project pattern.
 *
 * Patterns:
 *   rest         — flat folder: controller + service + DTOs + repo
 *   ddd          — nested DDD: presentation/ application/ domain/ infrastructure/
 *   graphql      — flat folder: resolver + service + DTOs + repo (future)
 *   cqrs         — commands, queries, events with WS/queue integration
 *   minimal      — just controller + module index
 */
export async function generateModule(options: GenerateModuleOptions): Promise<string[]> {
  const { name, modulesDir, noEntity, noTests, repo = 'inmemory', force, dryRun } = options
  const shouldPluralize = options.pluralize !== false

  let pattern = options.pattern ?? 'ddd'
  if (options.minimal) pattern = 'minimal'

  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const plural = shouldPluralize ? pluralize(kebab) : kebab
  const pluralPascal = shouldPluralize ? pluralizePascal(pascal) : pascal
  const moduleDir = join(modulesDir, plural)

  const files: string[] = []
  let overwriteAll = force ?? false

  const write = async (relativePath: string, content: string) => {
    const fullPath = join(moduleDir, relativePath)
    if (dryRun) {
      files.push(fullPath)
      return
    }
    if (!overwriteAll && (await fileExists(fullPath))) {
      const answer = await promptUser(
        `  File already exists: ${relativePath}\n  Overwrite? (y/n/a = yes/no/all) `,
      )
      if (answer === 'a') {
        overwriteAll = true
      } else if (answer !== 'y') {
        console.log(`  Skipped: ${relativePath}`)
        return
      }
    }
    await writeFileSafe(fullPath, content)
    files.push(fullPath)
  }

  const ctx: ModuleContext = {
    kebab,
    pascal,
    plural,
    pluralPascal,
    moduleDir,
    repo,
    noEntity: noEntity ?? false,
    noTests: noTests ?? false,
    prismaClientPath: options.prismaClientPath ?? '@prisma/client',
    write,
    files,
  }

  switch (pattern) {
    case 'minimal':
      await generateMinimalFiles(ctx)
      break
    case 'rest':
      await generateRestFiles(ctx)
      break
    case 'cqrs':
      await generateCqrsFiles(ctx)
      break
    case 'graphql':
    case 'ddd':
    default:
      await generateDddFiles(ctx)
      break
  }

  // Auto-register in modules index (all patterns need this)
  if (!dryRun) {
    await autoRegisterModule(modulesDir, pascal, plural)
  }

  return files
}

// ── Auto-register in modules index ──────────────────────────────────────

/** Add the new module to src/modules/index.ts */
async function autoRegisterModule(
  modulesDir: string,
  pascal: string,
  plural: string,
): Promise<void> {
  const indexPath = join(modulesDir, 'index.ts')
  const exists = await fileExists(indexPath)

  if (!exists) {
    await writeFileSafe(
      indexPath,
      `import type { AppModuleClass } from '@forinda/kickjs'
import { ${pascal}Module } from './${plural}'

export const modules: AppModuleClass[] = [${pascal}Module]
`,
    )
    return
  }

  let content = await readFile(indexPath, 'utf-8')

  // Add import if not present
  const importLine = `import { ${pascal}Module } from './${plural}'`
  if (!content.includes(`${pascal}Module`)) {
    // Insert import after last existing import
    const lastImportIdx = content.lastIndexOf('import ')
    if (lastImportIdx !== -1) {
      const lineEnd = content.indexOf('\n', lastImportIdx)
      content = content.slice(0, lineEnd + 1) + importLine + '\n' + content.slice(lineEnd + 1)
    } else {
      content = importLine + '\n' + content
    }

    // Add to modules array — handle both empty and existing entries
    // Match the array assignment: `= [...]` or `= [\n...\n]`
    content = content.replace(/(=\s*\[)([\s\S]*?)(])/, (_match, open, existing, close) => {
      const trimmed = existing.trim()
      if (!trimmed) {
        // Empty array: `= []`
        return `${open}${pascal}Module${close}`
      }
      // Existing entries: append with comma
      const needsComma = trimmed.endsWith(',') ? '' : ','
      return `${open}${existing.trimEnd()}${needsComma} ${pascal}Module${close}`
    })
  }

  await writeFile(indexPath, content, 'utf-8')
}
