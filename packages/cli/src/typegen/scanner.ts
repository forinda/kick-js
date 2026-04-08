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

/** A single route handler discovered on a controller class */
export interface DiscoveredRoute {
  /** Owning controller class name (e.g. 'UserController') */
  controller: string
  /** Handler method name on the controller (e.g. 'getUser') */
  method: string
  /** HTTP verb (uppercase) */
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** Route path including parameter placeholders (e.g. '/:id/posts/:postId') */
  path: string
  /** URL path parameter names extracted from `:placeholder` segments */
  pathParams: string[]
  /**
   * Whitelisted query field names extracted from `@ApiQueryParams({...})`.
   * `null` means no `@ApiQueryParams` was found on this method (so the
   * generator emits an unconstrained `query` shape). An empty array means
   * the decorator existed but no fields could be statically extracted
   * (e.g. an opaque imported config).
   */
  queryFilterable: string[] | null
  querySortable: string[] | null
  querySearchable: string[] | null
  /** Absolute file path of the controller */
  filePath: string
  /** Path relative to scan root, with forward slashes */
  relativePath: string
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
  routes: DiscoveredRoute[]
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

/** HTTP route decorator names recognised by the scanner */
const HTTP_DECORATORS = ['Get', 'Post', 'Put', 'Delete', 'Patch'] as const

/**
 * Match a route decorator immediately followed by a method declaration.
 * Captures the HTTP verb, path literal (or empty), and method name.
 *
 * Tolerates:
 * - Optional second arg to the route decorator (`@Get('/path', { ... })`)
 * - Stacked decorators between the route and the method (`@Get('/') @Use(...)`)
 * - Path-less decorators (`@Get()` → defaults to `/`)
 * - `async` modifier on the method
 *
 * Run within a class body slice (see extractRoutesFromSource) so the
 * captured method name is unambiguously a method on that class.
 */
const ROUTE_METHOD_REGEX = new RegExp(
  String.raw`@(${HTTP_DECORATORS.join('|')})\s*\(` +
    String.raw`(?:\s*['"\`]([^'"\`]*)['"\`])?[^)]*\)` +
    String.raw`(?:\s*@[A-Z]\w*(?:\s*\([^)]*\))?)*` +
    String.raw`\s*(?:public\s+|private\s+|protected\s+)?(?:async\s+)?` +
    String.raw`([a-zA-Z_]\w*)\s*\(`,
  'g',
)

/** Extract `:placeholder` segments from an Express route path */
function extractPathParams(path: string): string[] {
  const matches = path.match(/:([a-zA-Z_]\w*)/g) ?? []
  return matches.map((m) => m.slice(1))
}

/**
 * Extract whitelist arrays from an `@ApiQueryParams(...)` decorator
 * within `decoratorBlock`. Handles two forms:
 *
 * - Inline literal: `@ApiQueryParams({ filterable: ['a', 'b'], ... })`
 * - Const reference: `@ApiQueryParams(SOME_CONFIG)` — looks up
 *   `const SOME_CONFIG = { ... }` in the same file (`fullSource`).
 *
 * Returns `null` if no `@ApiQueryParams` is present. Returns
 * `{ filterable: [], sortable: [], searchable: [] }` if the decorator
 * is present but no fields could be statically extracted (opaque
 * imports, column-object configs, function calls, etc.).
 */
function extractApiQueryParams(
  decoratorBlock: string,
  fullSource: string,
): { filterable: string[]; sortable: string[]; searchable: string[] } | null {
  const apiMatch = /@ApiQueryParams\s*\(\s*([\s\S]*?)\s*\)\s*$/.exec(decoratorBlock)
  if (!apiMatch) {
    // Try without anchoring to the end (decorator may not be the last in the block)
    const loose = /@ApiQueryParams\s*\(([\s\S]*?)\)/.exec(decoratorBlock)
    if (!loose) return null
    return parseApiQueryParamsArg(loose[1].trim(), fullSource)
  }
  return parseApiQueryParamsArg(apiMatch[1].trim(), fullSource)
}

function parseApiQueryParamsArg(
  arg: string,
  fullSource: string,
): { filterable: string[]; sortable: string[]; searchable: string[] } {
  // Inline literal — starts with `{`
  if (arg.startsWith('{')) {
    return parseInlineConfigLiteral(arg)
  }
  // Const reference — bare identifier (possibly with type assertion)
  const idMatch = /^([A-Za-z_]\w*)/.exec(arg)
  if (idMatch) {
    const ident = idMatch[1]
    // Look for `const IDENT = { ... }` in the same source file
    const constRe = new RegExp(
      String.raw`const\s+${ident}\s*(?::\s*[^=]+)?=\s*(\{[\s\S]*?\n\})`,
      'm',
    )
    const constMatch = constRe.exec(fullSource)
    if (constMatch) {
      return parseInlineConfigLiteral(constMatch[1])
    }
  }
  // Fallback: decorator present but extraction failed
  return { filterable: [], sortable: [], searchable: [] }
}

/** Extract a string array literal for one config key from an inline object literal */
function extractStringArray(literal: string, key: string): string[] {
  const re = new RegExp(String.raw`${key}\s*:\s*\[([\s\S]*?)\]`)
  const m = re.exec(literal)
  if (!m) return []
  return Array.from(m[1].matchAll(/['"`]([^'"`]+)['"`]/g)).map((x) => x[1])
}

/** Parse an inline `{ filterable: [...], sortable: [...], searchable: [...] }` literal */
function parseInlineConfigLiteral(literal: string): {
  filterable: string[]
  sortable: string[]
  searchable: string[]
} {
  return {
    filterable: extractStringArray(literal, 'filterable'),
    sortable: extractStringArray(literal, 'sortable'),
    searchable: extractStringArray(literal, 'searchable'),
  }
}

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

/**
 * Extract route handlers from a source file.
 *
 * For each decorated class in `classesInFile`, slices the source from
 * the class declaration to the next class (or EOF) and runs the route
 * decorator regex within that slice. The result is a list of routes
 * tagged with their owning controller.
 *
 * Heuristic note: this assumes classes are not nested. KickJS controllers
 * are top-level by convention so this holds in practice.
 */
export function extractRoutesFromSource(
  source: string,
  filePath: string,
  cwd: string,
  classesInFile: DiscoveredClass[],
): DiscoveredRoute[] {
  const out: DiscoveredRoute[] = []
  if (classesInFile.length === 0) return out
  const relPath = toRelative(filePath, cwd)

  // Locate each class declaration's offset in the source
  const positions: Array<{ cls: DiscoveredClass; start: number }> = []
  for (const cls of classesInFile) {
    const re = new RegExp(String.raw`class\s+${cls.className}\b`)
    const m = re.exec(source)
    if (m?.index !== undefined) {
      positions.push({ cls, start: m.index })
    }
  }
  positions.sort((a, b) => a.start - b.start)

  for (let i = 0; i < positions.length; i++) {
    const { cls, start } = positions[i]
    const end = i + 1 < positions.length ? positions[i + 1].start : source.length
    const block = source.slice(start, end)

    ROUTE_METHOD_REGEX.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = ROUTE_METHOD_REGEX.exec(block)) !== null) {
      const [matchedText, verb, pathLiteral, methodName] = match
      const path = pathLiteral && pathLiteral.length > 0 ? pathLiteral : '/'

      // The route regex already greedily matched any stacked decorators
      // BETWEEN the route decorator and the method declaration. Inspect
      // the matched substring for an `@ApiQueryParams(...)` call.
      const apiQp = extractApiQueryParams(matchedText, source)

      out.push({
        controller: cls.className,
        method: methodName,
        httpMethod: verb.toUpperCase() as DiscoveredRoute['httpMethod'],
        path,
        pathParams: extractPathParams(path),
        queryFilterable: apiQp?.filterable ?? null,
        querySortable: apiQp?.sortable ?? null,
        querySearchable: apiQp?.searchable ?? null,
        filePath,
        relativePath: relPath,
      })
    }
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
  const routes: DiscoveredRoute[] = []
  const tokens: DiscoveredToken[] = []
  const injects: DiscoveredInject[] = []

  // Two passes: first collect all classes, then a second pass extracts
  // routes per file using the per-file class list as scoping context.
  // This keeps class discovery and route discovery independent.
  const sources = new Map<string, string>()
  for (const file of files) {
    let source: string
    try {
      source = await readFile(file, 'utf-8')
    } catch {
      continue
    }
    sources.set(file, source)
    classes.push(...extractClassesFromSource(source, file, opts.cwd))
    tokens.push(...extractTokensFromSource(source, file, opts.cwd))
    injects.push(...extractInjectsFromSource(source, file, opts.cwd))
  }

  for (const [file, source] of sources) {
    const classesInFile = classes.filter((c) => c.filePath === file)
    routes.push(...extractRoutesFromSource(source, file, opts.cwd, classesInFile))
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
  routes.sort(
    (a, b) => a.controller.localeCompare(b.controller) || a.method.localeCompare(b.method),
  )

  const collisions = findCollisions(classes)

  return { classes, routes, tokens, injects, collisions }
}
