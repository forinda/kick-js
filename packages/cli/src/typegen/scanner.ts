/**
 * Static scanner for KickJS decorated classes and DI tokens.
 *
 * Walks `src/**\/*.ts` (excluding tests and node_modules) and extracts:
 *
 * - Decorated classes (`@Service`, `@Controller`, `@Repository`, etc.)
 * - `createToken<T>('name')` definitions
 * - `@Inject('literal')` calls
 *
 * The output feeds the type generator, which emits `.kickjs/types/*.d.ts`
 * files used by the user's tsc to make `container.resolve()` and module
 * discovery type-safe.
 *
 * This is intentionally regex-based (not AST-based) to avoid the
 * ts-morph / typescript compiler dependency. Pattern from
 * `packages/vite/src/module-discovery.ts` which already uses regex
 * to detect `*.module.ts` exports.
 *
 * ## Collision detection
 *
 * Two classes with the same name across different files is a collision.
 * The scanner records all collisions in `ScanResult.collisions` so the
 * caller (generator) can decide whether to hard-error or auto-namespace.
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

/** A `createToken<T>('name')` call discovered in source */
export interface DiscoveredToken {
  /** The literal string passed to `createToken()` */
  name: string
  /** The const variable name on the LHS, if any */
  variable: string | null
  /** Absolute file path */
  filePath: string
  /** Path relative to scan root, with forward slashes */
  relativePath: string
}

/** An `@Inject('literal')` call discovered in source */
export interface DiscoveredInject {
  /** The literal string passed to `@Inject()` */
  name: string
  /** Absolute file path */
  filePath: string
  /** Path relative to scan root, with forward slashes */
  relativePath: string
}

/** A name collision — same class name in two or more files */
export interface ClassCollision {
  /** The colliding class name */
  className: string
  /** All files declaring the class */
  classes: DiscoveredClass[]
}

/** Aggregated scanner output */
export interface ScanResult {
  classes: DiscoveredClass[]
  tokens: DiscoveredToken[]
  injects: DiscoveredInject[]
  collisions: ClassCollision[]
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
 */
const DECORATED_CLASS_REGEX = new RegExp(
  String.raw`@(${DECORATOR_NAMES.join('|')})\s*\([^)]*\)` +
    String.raw`(?:\s*@[A-Z]\w*(?:\s*\([^)]*\))?)*` +
    String.raw`\s*export\s+(default\s+)?(?:abstract\s+)?class\s+(\w+)`,
  'g',
)

/**
 * Match a `createToken<T>('name')` call with optional `export const X =`
 * or `const X =` prefix. Tolerates whitespace and the type parameter
 * being absent (`createToken('name')`).
 */
const CREATE_TOKEN_REGEX =
  /(?:export\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?=\s*createToken\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g

/**
 * Match a bare `createToken<T>('name')` call (no const assignment) so
 * we still pick up dynamically-used tokens.
 */
const BARE_CREATE_TOKEN_REGEX = /createToken\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g

/** Match `@Inject('literal')` — only literals; computed args are skipped */
const INJECT_LITERAL_REGEX = /@Inject\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g

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

/** Compute the forward-slash relative path used in scanner output */
function toRelative(filePath: string, cwd: string): string {
  return relative(cwd, filePath).split(sep).join('/')
}

/** Extract decorated classes from a single source file */
export function extractClassesFromSource(
  source: string,
  filePath: string,
  cwd: string,
): DiscoveredClass[] {
  const out: DiscoveredClass[] = []
  const relPath = toRelative(filePath, cwd)

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

/** Extract `createToken('name')` definitions from a single source file */
export function extractTokensFromSource(
  source: string,
  filePath: string,
  cwd: string,
): DiscoveredToken[] {
  const out: DiscoveredToken[] = []
  const relPath = toRelative(filePath, cwd)
  const seen = new Set<string>()

  // First pass: const-bound tokens (preferred — we get the variable name)
  CREATE_TOKEN_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CREATE_TOKEN_REGEX.exec(source)) !== null) {
    const [full, variable, name] = match
    seen.add(full)
    out.push({ name, variable, filePath, relativePath: relPath })
  }

  // Second pass: bare calls not captured above (rare but possible)
  BARE_CREATE_TOKEN_REGEX.lastIndex = 0
  while ((match = BARE_CREATE_TOKEN_REGEX.exec(source)) !== null) {
    if (seen.has(match[0])) continue
    out.push({
      name: match[1],
      variable: null,
      filePath,
      relativePath: relPath,
    })
  }

  return out
}

/** Extract `@Inject('literal')` calls from a single source file */
export function extractInjectsFromSource(
  source: string,
  filePath: string,
  cwd: string,
): DiscoveredInject[] {
  const out: DiscoveredInject[] = []
  const relPath = toRelative(filePath, cwd)

  INJECT_LITERAL_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INJECT_LITERAL_REGEX.exec(source)) !== null) {
    out.push({ name: match[1], filePath, relativePath: relPath })
  }

  return out
}

/** Detect duplicate class names across files */
export function findCollisions(classes: DiscoveredClass[]): ClassCollision[] {
  const groups = new Map<string, DiscoveredClass[]>()
  for (const cls of classes) {
    const arr = groups.get(cls.className) ?? []
    arr.push(cls)
    groups.set(cls.className, arr)
  }

  const collisions: ClassCollision[] = []
  for (const [className, group] of groups) {
    // Two declarations of the same class name in different files = collision.
    // Multiple decorators on the same file/class are NOT a collision.
    const distinctFiles = new Set(group.map((c) => c.filePath))
    if (distinctFiles.size > 1) {
      collisions.push({ className, classes: group })
    }
  }

  // Deterministic order
  collisions.sort((a, b) => a.className.localeCompare(b.className))
  return collisions
}

/**
 * Scan a project for decorated classes, createToken definitions, and
 * `@Inject` literal usages.
 */
export async function scanProject(opts: ScanOptions): Promise<ScanResult> {
  const root = resolve(opts.root)
  const files = await walk(root, opts)

  const classes: DiscoveredClass[] = []
  const tokens: DiscoveredToken[] = []
  const injects: DiscoveredInject[] = []

  for (const file of files) {
    let source: string
    try {
      source = await readFile(file, 'utf-8')
    } catch {
      continue
    }
    classes.push(...extractClassesFromSource(source, file, opts.cwd))
    tokens.push(...extractTokensFromSource(source, file, opts.cwd))
    injects.push(...extractInjectsFromSource(source, file, opts.cwd))
  }

  // Deterministic ordering for stable .d.ts output
  classes.sort((a, b) => {
    if (a.className !== b.className) return a.className.localeCompare(b.className)
    return a.relativePath.localeCompare(b.relativePath)
  })
  tokens.sort(
    (a, b) => a.name.localeCompare(b.name) || a.relativePath.localeCompare(b.relativePath),
  )
  injects.sort(
    (a, b) => a.name.localeCompare(b.name) || a.relativePath.localeCompare(b.relativePath),
  )

  const collisions = findCollisions(classes)

  return { classes, tokens, injects, collisions }
}
