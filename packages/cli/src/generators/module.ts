import { join } from 'node:path'
import { writeFileSafe, fileExists } from '../utils/fs'
import { confirm, log } from '../utils/prompts'
import { colors } from '../utils/colors'
import { toPascalCase, toKebabCase, pluralize, pluralizePascal } from '../utils/naming'
import { readFile, writeFile } from 'node:fs/promises'
import type { ProjectPattern, RepoTypeConfig } from '../config'
import type { ModuleStyle } from './templates/types'
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
  /**
   * DI-token scope prefix substituted into emitted `createToken<T>()`
   * literals. Resolved by the orchestrating command from
   * `kick.config.ts > tokenScope` or the project's package.json.
   * Falls back to `'app'` when not set so the generator can be called
   * without a config in tests/fixtures.
   */
  tokenScope?: string
  /**
   * Module declaration style — `'define'` (factory, default) or
   * `'class'` (legacy). Resolved by the orchestrating command from
   * `kick.config.ts > modules.style`.
   */
  style?: ModuleStyle
}

/**
 * Generate a module — structure depends on the project pattern.
 *
 * Patterns:
 *   rest         — flat folder: controller + service + DTOs + repo
 *   ddd          — nested DDD: presentation/ application/ domain/ infrastructure/
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
      const shouldOverwrite = await confirm({
        message: `File exists: ${colors.dim(relativePath)}. Overwrite?`,
        initialValue: false,
      })
      if (!shouldOverwrite) {
        log.warn(`Skipped: ${relativePath}`)
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
    tokenScope: options.tokenScope ?? 'app',
    style: options.style ?? 'define',
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
    case 'ddd':
    default:
      await generateDddFiles(ctx)
      break
  }

  // Auto-register in modules index (all patterns need this)
  if (!dryRun) {
    await autoRegisterModule(modulesDir, pascal, plural, kebab, ctx.style)
  }

  return files
}

// ── Auto-register in modules index ──────────────────────────────────────

/** Add the new module to src/modules/index.ts */
async function autoRegisterModule(
  modulesDir: string,
  pascal: string,
  plural: string,
  kebab: string,
  style: ModuleStyle = 'define',
): Promise<void> {
  const indexPath = join(modulesDir, 'index.ts')
  const exists = await fileExists(indexPath)
  const importPath = `./${plural}/${kebab}.module`
  // `defineModule` factories are called at the registration site
  // (`${pascal}Module()`); legacy class modules are passed by reference
  // (`${pascal}Module`). Application's loader discriminates class vs
  // instance at boot, so both forms work — `style` only controls what
  // the orchestrator emits.
  const entryToken = style === 'class' ? `${pascal}Module` : `${pascal}Module()`

  if (!exists) {
    // For 'class' style we emit the legacy flat-array form because
    // `defineModules` is the factory-form companion. For 'define' (default)
    // we emit the fluent `defineModules().mount(...)` chain so subsequent
    // `kick g module` invocations append cleanly.
    const initialBody =
      style === 'class'
        ? `import type { AppModuleEntry } from '@forinda/kickjs'
import { ${pascal}Module } from '${importPath}'

export const modules: AppModuleEntry[] = [${entryToken}]
`
        : `import { defineModules } from '@forinda/kickjs'
import { ${pascal}Module } from '${importPath}'

export const modules = defineModules().mount(${entryToken})
`
    await writeFileSafe(indexPath, initialBody)
    return
  }

  let content = await readFile(indexPath, 'utf-8')

  // Add import if not present
  const importLine = `import { ${pascal}Module } from '${importPath}'`
  if (!content.includes(`${pascal}Module`)) {
    // Insert import after last existing import
    const lastImportIdx = content.lastIndexOf('import ')
    if (lastImportIdx !== -1) {
      const lineEnd = content.indexOf('\n', lastImportIdx)
      content = content.slice(0, lineEnd + 1) + importLine + '\n' + content.slice(lineEnd + 1)
    } else {
      content = importLine + '\n' + content
    }

    content = appendModuleEntry(content, entryToken)
  }

  await writeFile(indexPath, content, 'utf-8')
}

/**
 * Append `entryToken` (e.g. `LionModule()` or bare `LionModule`) to
 * the project's modules registry. Handles two shapes:
 *
 *   1. Flat array literal:
 *      `export const modules: AppModuleEntry[] = [HelloModule()]`
 *   2. Fluent factory chain:
 *      `export const modules = defineModules().mount(HelloModule())`
 *
 * If neither shape is detected, content is returned unchanged — the
 * adopter's registration site is non-standard and they mount the
 * new module themselves.
 *
 * Exported so `scaffold.ts`'s auto-register can reuse the same
 * balanced-paren scanner — duplicating the regex caused
 * `mount(UserModule())` to corrupt on the scaffold path before this
 * was hoisted out.
 */
export function appendModuleEntry(content: string, entryToken: string): string {
  // Shape 1 — flat array literal. Existing behaviour.
  const arrayMatch = /(=\s*\[)([\s\S]*?)(])/.exec(content)
  if (arrayMatch) {
    return content.replace(/(=\s*\[)([\s\S]*?)(])/, (_match, open, existing, close) => {
      const trimmed = existing.trim()
      if (!trimmed) return `${open}${entryToken}${close}`
      const needsComma = trimmed.endsWith(',') ? '' : ','
      return `${open}${existing.trimEnd()}${needsComma} ${entryToken}${close}`
    })
  }

  // Shape 2 — `defineModules()` fluent chain. Walk forward from
  // `defineModules(...)` consuming `.mount(...)` calls with a
  // balanced-paren scanner so nested parens (`mount(UserModule())`)
  // don't confuse the boundary. We need a real scanner here — a
  // naive `\.mount\([^)]*\)` regex matches `mount(UserModule()`
  // and breaks subsequent appends.
  const chainEnd = findChainEnd(content)
  if (chainEnd !== -1) {
    return `${content.slice(0, chainEnd)}\n  .mount(${entryToken})${content.slice(chainEnd)}`
  }

  // Unknown shape — leave untouched. The import was added; adopter
  // mounts manually.
  return content
}

/**
 * Locate the insertion point after the last `.mount(...)` call in a
 * `defineModules()...` chain, or after `defineModules()` itself when
 * the chain is empty. Returns the source-string offset to insert at,
 * or -1 when the chain isn't found.
 *
 * The scanner walks balanced parens so nested factory calls inside
 * `.mount(X())` don't break boundary detection.
 */
function findChainEnd(src: string): number {
  // Match the CALL site, not the import statement. We require an
  // immediately-following `(` (allowing whitespace) to anchor on
  // `defineModules(...)` and skip past `import { defineModules }`.
  const callRegex = /defineModules\s*\(/g
  const match = callRegex.exec(src)
  if (!match) return -1
  // `match.index` points at `d`; `(` is at `match.index + match[0].length - 1`.
  let i = match.index + match[0].length - 1
  if (src[i] !== '(') return -1
  // Balance the args of `defineModules(...)`.
  i = balancedClose(src, i)
  if (i === -1) return -1
  i++
  // Now consume zero or more `.mount(...)` calls. After each, `i`
  // points just past its closing `)` so the next iteration sees a
  // potential `.mount(...)` ahead.
  for (;;) {
    let j = i
    while (j < src.length && /\s/.test(src[j] ?? '')) j++
    if (src[j] !== '.') break
    if (src.slice(j, j + 6) !== '.mount') break
    j += 6
    while (j < src.length && /\s/.test(src[j] ?? '')) j++
    if (src[j] !== '(') break
    const close = balancedClose(src, j)
    if (close === -1) break
    i = close + 1
  }
  return i
}

/**
 * Given an offset pointing at `(`, return the offset of its matching
 * `)`, or -1 on imbalance. Skips parens inside string literals
 * (single, double, backtick) — the `mount()` args may include
 * scoped-name strings.
 */
function balancedClose(src: string, openIdx: number): number {
  if (src[openIdx] !== '(') return -1
  let depth = 1
  let i = openIdx + 1
  while (i < src.length) {
    const ch = src[i] ?? ''
    if (ch === "'" || ch === '"' || ch === '`') {
      // Skip string literal — find matching unescaped quote.
      const quote = ch
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++
        i++
      }
      if (i < src.length) i++
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}
