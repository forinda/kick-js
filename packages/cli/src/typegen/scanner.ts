/**
 * Static scanner for KickJS decorated classes.
 *
 * Walks `src/**\/*.ts` (excluding tests and node_modules) and extracts
 * decorated class declarations via regex. The output feeds the type
 * generator, which emits `.kickjs/types/*.d.ts` files used by the
 * user's tsc to make `container.resolve()` and module discovery
 * type-safe.
 *
 * This is intentionally regex-based (not AST-based) to avoid the
 * ts-morph / typescript compiler dependency. Pattern from
 * `packages/vite/src/module-discovery.ts` which already uses regex
 * to detect `*.module.ts` exports.
 *
 * @module @forinda/kickjs-cli/typegen/scanner
 */

import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

/** Decorators that mark a class as DI-managed */
export const DECORATOR_NAMES = [
  'Service',
  'Controller',
  'Repository',
  'Injectable',
  'Component',
  'Module',
] as const

export type DecoratorName = (typeof DECORATOR_NAMES)[number]

/** A single discovered decorated class */
export interface DiscoveredClass {
  /** Class name (e.g., 'UserService') */
  className: string
  /** Decorator that marked it (e.g., 'Service') */
  decorator: DecoratorName
  /** Absolute file path */
  filePath: string
  /** Path relative to scan root, with forward slashes */
  relativePath: string
  /** True if exported as `default` */
  isDefault: boolean
}

/** Options for the scanner */
export interface ScanOptions {
  /** Root directory to scan (e.g., absolute path to `src`) */
  root: string
  /** Project root used to compute relative paths (e.g., process.cwd()) */
  cwd: string
  /** Glob-like extensions to scan */
  extensions?: string[]
  /** Substrings that exclude a path (matched against relative path) */
  exclude?: string[]
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']
const DEFAULT_EXCLUDES = ['node_modules', '.kickjs', 'dist', 'build', '.test.', '.spec.', '.d.ts']

/**
 * Match a class-level decorator immediately followed by an exported
 * class declaration. Captures decorator name and class name.
 *
 * Tolerates:
 * - Stacked decorators (`@Service() @SomethingElse() class Foo`)
 * - Multi-line decorator args (`@Controller(\n  '/users'\n)`)
 * - `export default class`, `export abstract class`
 *
 * Limitation: nested parens in the first decorator's args are not
 * tracked precisely. For class-level decorators (Service, Controller,
 * etc.) this is rarely an issue.
 */
const DECORATED_CLASS_REGEX = new RegExp(
  // 1. The kickjs decorator with optional argument list
  String.raw`@(${DECORATOR_NAMES.join('|')})\s*\([^)]*\)` +
    // 2. Optional stacked decorators (any name)
    String.raw`(?:\s*@[A-Z]\w*(?:\s*\([^)]*\))?)*` +
    // 3. The exported class (named or default)
    String.raw`\s*export\s+(default\s+)?(?:abstract\s+)?class\s+(\w+)`,
  'g',
)

/** Recursively walk a directory and yield matching file paths */
async function walk(dir: string, opts: ScanOptions): Promise<string[]> {
  const exts = opts.extensions ?? DEFAULT_EXTENSIONS
  const excludes = opts.exclude ?? DEFAULT_EXCLUDES
  const out: string[] = []

  let entries: Dirent[]
  try {
    entries = (await readdir(dir, { withFileTypes: true, encoding: 'utf-8' })) as Dirent[]
  } catch {
    return out
  }

  for (const entry of entries) {
    const full = join(dir, entry.name)
    const rel = relative(opts.cwd, full)

    if (excludes.some((ex) => rel.includes(ex))) continue

    if (entry.isDirectory()) {
      out.push(...(await walk(full, opts)))
    } else if (entry.isFile()) {
      if (exts.some((ext) => entry.name.endsWith(ext))) {
        out.push(full)
      }
    }
  }

  return out
}

/** Extract decorated classes from a single source file */
export function extractFromSource(
  source: string,
  filePath: string,
  cwd: string,
): DiscoveredClass[] {
  const out: DiscoveredClass[] = []
  const relPath = relative(cwd, filePath).split(sep).join('/')

  // Reset regex state for safe reuse
  DECORATED_CLASS_REGEX.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = DECORATED_CLASS_REGEX.exec(source)) !== null) {
    const [, decorator, defaultMarker, className] = match
    out.push({
      className,
      decorator: decorator as DecoratorName,
      filePath,
      relativePath: relPath,
      isDefault: Boolean(defaultMarker),
    })
  }

  return out
}

/**
 * Scan a project for decorated classes.
 *
 * @example
 * ```ts
 * const classes = await scanProject({
 *   root: resolve(process.cwd(), 'src'),
 *   cwd: process.cwd(),
 * })
 * ```
 */
export async function scanProject(opts: ScanOptions): Promise<DiscoveredClass[]> {
  const root = resolve(opts.root)
  const files = await walk(root, opts)
  const out: DiscoveredClass[] = []

  for (const file of files) {
    let source: string
    try {
      source = await readFile(file, 'utf-8')
    } catch {
      continue
    }
    out.push(...extractFromSource(source, file, opts.cwd))
  }

  // Deterministic order — class name alphabetical, ties broken by file path.
  out.sort((a, b) => {
    if (a.className !== b.className) return a.className.localeCompare(b.className)
    return a.relativePath.localeCompare(b.relativePath)
  })

  return out
}
