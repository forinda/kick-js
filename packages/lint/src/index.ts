/**
 * Programmatic entry point for `@forinda/kickjs-lint`.
 *
 * Walks a directory tree, applies every enabled rule from
 * {@link ./rules} to each file that matches the token-bearing filename
 * heuristic, and returns the aggregated violations.
 *
 * The CLI binary (`bin.mjs`) wraps this with a process-exit translation
 * layer; downstream tools (devtools, editor extensions) call this
 * directly.
 *
 * @module @forinda/kickjs-lint
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { rules as defaultRules, type Rule, type Violation } from './rules'

export type { LintContext, Rule, Violation } from './rules'
export { diTokenSymbol, tokenKickPrefix, tokenReservedPrefix, rules as defaultRules } from './rules'

/**
 * Filenames that historically declare DI tokens. Lint runs only on
 * these to keep false positives out of unrelated files (e.g. a class
 * named `Symbol` in a math library).
 *
 * `database.ts`, `interfaces.ts`, `client.ts` were added after a
 * regression where `TENANT_DB = Symbol(...)` slipped past the rule by
 * living in `database.ts` rather than `tokens.ts` / `constants.ts`.
 */
export const TOKEN_FILE_NAMES = new Set([
  'types.ts',
  'tokens.ts',
  'constants.ts',
  'service.ts',
  'adapter.ts',
  'database.ts',
  'interfaces.ts',
  'client.ts',
])

/** Directories the walker skips wholesale. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '.kickjs'])

export interface LintOptions {
  /** Root directory to walk. Required. */
  cwd: string
  /**
   * Whether the project being linted is a first-party `@forinda/kickjs-*`
   * package (enables `token-kick-prefix`, disables `token-reserved-prefix`).
   * Defaults to `false` so adopter projects use the friendlier ruleset.
   */
  firstParty?: boolean
  /**
   * Only lint files inside these subdirectories (relative to `cwd`).
   * Defaults to `['packages']` for first-party use; pass `['src']` or
   * `['.']` for adopter projects.
   */
  scope?: readonly string[]
  /** Override the rule set. Defaults to every rule shipped by the package. */
  rules?: readonly Rule[]
  /** Filenames to lint (defaults to {@link TOKEN_FILE_NAMES}). */
  filenames?: ReadonlySet<string>
}

export interface LintResult {
  violations: Violation[]
  filesScanned: number
}

/**
 * Walk `cwd` (constrained to `scope` directories), apply every rule to
 * each token-bearing file, and return the aggregated violations + the
 * number of files actually checked.
 */
export async function runLint(opts: LintOptions): Promise<LintResult> {
  const cwd = opts.cwd
  const firstParty = opts.firstParty ?? false
  const scope = opts.scope ?? ['packages']
  const ruleset = opts.rules ?? defaultRules
  const filenames = opts.filenames ?? TOKEN_FILE_NAMES

  const violations: Violation[] = []
  let filesScanned = 0

  for (const root of scope) {
    const start = join(cwd, root)
    await walk(start, async (file) => {
      const base = file.slice(file.lastIndexOf('/') + 1)
      if (!filenames.has(base)) return
      const source = await readFile(file, 'utf-8')
      const rel = relative(cwd, file)
      filesScanned++
      for (const rule of ruleset) {
        violations.push(...rule.check({ source, file: rel, firstParty }))
      }
    })
  }

  return { violations, filesScanned }
}

async function walk(dir: string, visit: (file: string) => Promise<void>): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(full, visit)
    } else if (entry.isFile()) {
      await visit(full)
    }
  }
}

/**
 * Format a violation list for terminal output. One block per violation,
 * trailing summary line. Returns `''` when there are no violations so
 * callers can branch on truthiness.
 */
export function formatViolations(violations: readonly Violation[]): string {
  if (violations.length === 0) return ''
  const lines: string[] = []
  for (const v of violations) {
    const tag = v.severity === 'error' ? 'error' : 'warn'
    lines.push(`  [${tag}] ${v.file}:${v.line}  ${v.ruleId}`)
    lines.push(`    ${v.message}`)
    if (v.suggestion) lines.push(`    -> ${v.suggestion}`)
    lines.push('')
  }
  const errors = violations.filter((v) => v.severity === 'error').length
  const warnings = violations.length - errors
  lines.push(`${violations.length} violation(s): ${errors} error, ${warnings} warn`)
  return lines.join('\n')
}
