import { join } from 'node:path'
import { writeFileSafe, fileExists } from '../utils/fs'
import { confirm, log } from '../utils/prompts'
import { colors } from '../utils/colors'
import { toPascalCase, toKebabCase, pluralize, pluralizePascal } from '../utils/naming'
import { escapeRegex } from '../utils/regex'
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

/**
 * Add a new module to `src/modules/index.ts`. Handles both the
 * fresh-project initial-write path (creates the file with the right
 * shape for the resolved style) and the established-project append
 * path (inserts the import + extends the flat array OR fluent chain
 * via {@link appendModuleEntry}).
 *
 * Exported so `scaffold.ts` can reuse it — both call sites had
 * line-for-line identical bodies before consolidation, including
 * the inline-regex chain-append bug CodeRabbit caught on PR #196.
 * Single source of truth here keeps the orchestrator and scaffold
 * paths from drifting again.
 */
export async function autoRegisterModule(
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

  // Two independent checks — a stale comment, a doc snippet, or a
  // partially-edited file shouldn't make the gate skip both halves.
  //
  //   1. Import-line check: look for an exact `import { XModule }
  //      from '<importPath>'` statement, not just any `XModule`
  //      mention. A comment that names XModule doesn't satisfy this.
  //   2. Registry-entry check: look for `XModule` (word-bounded)
  //      inside the actual `export const modules` initializer rhs,
  //      not anywhere in the file. Recovers a half-edited registry
  //      where the import survived but the .mount entry was deleted.
  const importLine = `import { ${pascal}Module } from '${importPath}'`
  const escapedImportPath = escapeRegex(importPath)
  const importPresentRe = new RegExp(
    `^import\\s*\\{[^}]*\\b${escapeRegex(pascal)}Module\\b[^}]*\\}\\s*from\\s*['"]${escapedImportPath}['"]`,
    'm',
  )
  if (!importPresentRe.test(content)) {
    // Insert import after last existing import
    const lastImportIdx = content.lastIndexOf('import ')
    if (lastImportIdx !== -1) {
      const lineEnd = content.indexOf('\n', lastImportIdx)
      content = content.slice(0, lineEnd + 1) + importLine + '\n' + content.slice(lineEnd + 1)
    } else {
      content = importLine + '\n' + content
    }
  }

  // Independently confirm the registry rhs already names this entry
  // before skipping the append. Scoped to the `export const modules`
  // slice via `findModulesRhsSpan` so an `XModule` mention in an
  // unrelated builder above the registry doesn't mask a missing
  // `.mount(XModule())` further down.
  const span = findModulesRhsSpan(content)
  if (span) {
    const rhsSlice = content.slice(span.rhsStart, span.rhsEnd + 1)
    const entryPresentRe = new RegExp(`\\b${escapeRegex(pascal)}Module\\b`)
    if (!entryPresentRe.test(rhsSlice)) {
      content = appendModuleEntry(content, entryToken)
    }
  } else {
    // No recognizable registry shape — fall back to the previous
    // best-effort behaviour: try appending; appendModuleEntry returns
    // content unchanged when it can't find a target.
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
  const span = findModulesRhsSpan(content)
  if (!span) return content

  // Shape 1 — flat array literal at the rhs.
  if (span.shape === 'array') {
    const inside = content.slice(span.rhsStart + 1, span.rhsEnd)
    const trimmed = inside.trim()
    let rewritten: string
    if (!trimmed) {
      rewritten = `[${entryToken}]`
    } else {
      const needsComma = trimmed.endsWith(',') ? '' : ','
      rewritten = `[${inside.trimEnd()}${needsComma} ${entryToken}]`
    }
    return content.slice(0, span.rhsStart) + rewritten + content.slice(span.rhsEnd + 1)
  }

  // Shape 2 — `defineModules()` fluent chain at the rhs. Insert
  // `.mount(...)` right at `chainEnd` (the offset just past the
  // last `.mount(...)`'s closing `)` or just past `defineModules()`'s
  // closing `)` when the chain is empty).
  return `${content.slice(0, span.chainEnd)}\n  .mount(${entryToken})${content.slice(span.chainEnd)}`
}

/**
 * Span returned by {@link findModulesRhsSpan}. Both shapes carry the
 * `rhsStart` (the offset of `[` for arrays or `d` for the chain) and
 * an `end` offset describing where the rhs concludes:
 *
 *   - `array`: `rhsEnd` points at the matching `]` (inclusive).
 *   - `chain`: `chainEnd` points just past the last `.mount(...)`
 *      call (or just past `defineModules()`'s closing `)` when the
 *      chain is empty). For consistency with arrays, `rhsEnd =
 *      chainEnd - 1` so a `[rhsStart, rhsEnd + 1)` slice covers the
 *      whole initializer.
 */
type ModulesRhsSpan =
  | { shape: 'array'; rhsStart: number; rhsEnd: number }
  | { shape: 'chain'; rhsStart: number; rhsEnd: number; chainEnd: number }

/**
 * Locate the `export const modules = <rhs>` initializer in `content`
 * and return the rhs's start/end offsets along with which shape it
 * is (flat array vs `defineModules()` chain). Used by both the
 * append path (`appendModuleEntry`) AND the remove path
 * (`stripChainMount` / array-entry rm regex) so neither mutates
 * unrelated text elsewhere in the file.
 *
 * Returns `null` when no `export const modules` declaration is
 * found, or when its rhs doesn't match either supported shape.
 */
export function findModulesRhsSpan(content: string): ModulesRhsSpan | null {
  const declMatch = /export\s+const\s+modules\b[^=]*=/.exec(content)
  if (!declMatch) return null
  const eqEnd = declMatch.index + declMatch[0].length
  let rhsStart = eqEnd
  while (rhsStart < content.length && /\s/.test(content[rhsStart] ?? '')) rhsStart++

  if (content[rhsStart] === '[') {
    const close = balancedBracketClose(content, rhsStart)
    if (close === -1) return null
    return { shape: 'array', rhsStart, rhsEnd: close }
  }

  if (content.slice(rhsStart, rhsStart + 'defineModules'.length) === 'defineModules') {
    const chainEnd = findChainEnd(content, rhsStart)
    if (chainEnd === -1) return null
    return { shape: 'chain', rhsStart, rhsEnd: chainEnd - 1, chainEnd }
  }

  return null
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
function findChainEnd(src: string, fromIdx = 0): number {
  // Match the CALL site, not the import statement. We require an
  // immediately-following `(` (allowing whitespace) to anchor on
  // `defineModules(...)` and skip past `import { defineModules }`.
  // `fromIdx` lets the caller scope the search to the rhs of an
  // `export const modules =` declaration so unrelated calls
  // elsewhere in the file aren't matched.
  const callRegex = /defineModules\s*\(/g
  callRegex.lastIndex = fromIdx
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
 * Skip past a `//` line comment or `/* … *\/` block comment that
 * starts at offset `i`. Returns the offset of the first character
 * after the comment, or `i` unchanged when there's no comment at
 * that position. Used by the balanced-paren / bracket scanners so
 * a `]` or `)` inside a comment doesn't terminate the scan early.
 */
function skipComment(src: string, i: number): number {
  const two = src.slice(i, i + 2)
  if (two === '//') {
    i += 2
    while (i < src.length && src[i] !== '\n') i++
    return i
  }
  if (two === '/*') {
    i += 2
    while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
    return i + 2
  }
  return i
}

/**
 * Given an offset pointing at `[`, return the offset of its matching
 * `]`. Skips brackets inside string literals so `['weird]name']`
 * doesn't break, and inside `//` / `/* *\/` comments. Returns -1 on
 * imbalance.
 */
function balancedBracketClose(src: string, openIdx: number): number {
  if (src[openIdx] !== '[') return -1
  let depth = 1
  let i = openIdx + 1
  while (i < src.length) {
    const next = src.slice(i, i + 2)
    if (next === '//' || next === '/*') {
      i = skipComment(src, i)
      continue
    }
    const ch = src[i] ?? ''
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++
        i++
      }
      if (i < src.length) i++
      continue
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/**
 * Given an offset pointing at `(`, return the offset of its matching
 * `)`, or -1 on imbalance. Skips parens inside string literals
 * (single, double, backtick) and inside `//` / `/* *\/` comments —
 * a `)` in either would terminate the scan early and corrupt the
 * insertion offset.
 */
function balancedClose(src: string, openIdx: number): number {
  if (src[openIdx] !== '(') return -1
  let depth = 1
  let i = openIdx + 1
  while (i < src.length) {
    const next = src.slice(i, i + 2)
    if (next === '//' || next === '/*') {
      i = skipComment(src, i)
      continue
    }
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
