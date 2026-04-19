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
  /**
   * Schema identifiers referenced from the route decorator's second arg
   * (e.g. `@Post('/', { body: createTaskSchema })`). `null` means no
   * such reference; the value carries the identifier and the resolved
   * import source (relative module path) if known.
   */
  bodySchema: SchemaRef | null
  querySchema: SchemaRef | null
  paramsSchema: SchemaRef | null
  /** Absolute file path of the controller */
  filePath: string
  /** Path relative to scan root, with forward slashes */
  relativePath: string
}

/** A statically-resolved schema identifier reference */
export interface SchemaRef {
  /** The identifier as written (e.g. `createTaskSchema`) */
  identifier: string
  /**
   * Resolved module specifier (relative path or bare module name) where
   * the identifier is defined. `null` means the source could not be
   * statically determined (the generator falls back to `unknown`).
   */
  source: string | null
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

/**
 * Information about a discovered env schema file. The typegen
 * generator uses this to emit a `KickEnv` + `NodeJS.ProcessEnv`
 * augmentation that flows through to `@Value` and `process.env`.
 *
 * `null` means no env file was found at the configured location.
 */
export interface DiscoveredEnv {
  /** Absolute path to the env schema file */
  filePath: string
  /** Path relative to scan root, with forward slashes */
  relativePath: string
}

/** Aggregated scanner output */
export interface ScanResult {
  classes: DiscoveredClass[]
  routes: DiscoveredRoute[]
  tokens: DiscoveredToken[]
  injects: DiscoveredInject[]
  collisions: ClassCollision[]
  /** Discovered env schema file (or null if none found at the configured path) */
  env: DiscoveredEnv | null
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
  /**
   * Path to the env schema file, relative to `cwd`. Defaults to
   * `'src/env.ts'`. The file must contain a `defineEnv(...)` call
   * with a default export for the typegen to emit a typed `KickEnv`
   * augmentation. If the file does not exist or doesn't match the
   * expected shape, env typing is skipped silently.
   */
  envFile?: string
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
 * Locate the start of a route decorator: `@Get(`, `@Post(`, etc.
 * Used by `extractRoutesFromSource`; the rest of the route declaration
 * (balanced parens, stacked decorators, method name) is parsed by walking
 * the source forward from this match. The previous all-in-one regex
 * couldn't handle nested parens in stacked decorator args (e.g.
 * `@ApiResponse(201, { schema: z.object({ id: z.string() }) })`) — see
 * forinda/kick-js#108.
 */
const ROUTE_DECORATOR_START = new RegExp(String.raw`@(${HTTP_DECORATORS.join('|')})\s*\(`, 'g')

/**
 * Find the index of the `)` that balances the `(` at `openPos`.
 * Returns -1 if no matching `)` exists. Counts balanced parens only;
 * does not understand string literals, so a `(` or `)` inside a string
 * inside the args will skew the depth counter (matches the limitation
 * of `extractRouteOptionsArg`).
 */
function findBalancedClose(text: string, openPos: number): number {
  let depth = 1
  for (let i = openPos + 1; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Walk forward from the end of a route decorator past any stacked
 * decorators (`@ApiOperation(...)`, `@ApiResponse(...)`, `@Middleware(fn)`,
 * etc.), then past optional `public`/`private`/`protected` and `async`,
 * and capture the method name + opening `(`.
 *
 * Returns the method name and the position immediately after the method's
 * opening `(`, or `null` if the source between the route decorator and
 * the method body doesn't fit the expected shape.
 */
function readMethodAfterDecorators(
  block: string,
  startPos: number,
): { methodName: string; endPos: number } | null {
  let pos = startPos
  // Stacked decorators: @PascalCase optionally followed by balanced (...)
  while (pos < block.length) {
    while (pos < block.length && /\s/.test(block[pos])) pos++
    if (block[pos] !== '@') break
    const decMatch = block.slice(pos).match(/^@([A-Z]\w*)/)
    if (!decMatch) break
    pos += decMatch[0].length
    while (pos < block.length && /\s/.test(block[pos])) pos++
    if (block[pos] === '(') {
      const close = findBalancedClose(block, pos)
      if (close < 0) return null
      pos = close + 1
    }
  }
  // Modifiers + async
  while (pos < block.length && /\s/.test(block[pos])) pos++
  for (const mod of ['public', 'private', 'protected'] as const) {
    if (block.slice(pos, pos + mod.length) === mod && /\s/.test(block.charAt(pos + mod.length))) {
      pos += mod.length
      while (pos < block.length && /\s/.test(block[pos])) pos++
      break
    }
  }
  if (block.slice(pos, pos + 5) === 'async' && /\s/.test(block.charAt(pos + 5))) {
    pos += 5
    while (pos < block.length && /\s/.test(block[pos])) pos++
  }
  // Method name + `(`
  const methodMatch = block.slice(pos).match(/^([a-zA-Z_]\w*)\s*\(/)
  if (!methodMatch) return null
  return { methodName: methodMatch[1], endPos: pos + methodMatch[0].length }
}

/** Extract `:placeholder` segments from an Express route path */
function extractPathParams(path: string): string[] {
  const matches = path.match(/:([a-zA-Z_]\w*)/g) ?? []
  return matches.map((m) => m.slice(1))
}

/**
 * Extract a bare identifier value from a single field in an object literal
 * embedded in a string. Returns `null` if the field is missing or its value
 * isn't a bare identifier (e.g. an inline object, function call, etc.).
 *
 * Example: `extractObjectFieldIdentifier("'/' , { body: createTaskSchema }", 'body')`
 * returns `'createTaskSchema'`.
 */
function extractObjectFieldIdentifier(text: string, field: string): string | null {
  // Look for `field: <identifier>` not followed by `(` (function call) or `{` (inline object)
  const re = new RegExp(String.raw`\b${field}\s*:\s*([A-Za-z_$][\w$]*)`, 'g')
  const m = re.exec(text)
  if (!m) return null
  return m[1]
}

/**
 * Resolve a bare identifier to its module source by inspecting the file's
 * top-level imports and same-file `const` declarations.
 *
 * - `import { X } from './path'` → returns `'./path'`
 * - `import X from './path'` (default import) → returns `'./path'`
 * - `import * as X from './path'` → returns `'./path'`
 * - `const X = z.object(...)` (same file) → returns `null` (caller emits a self-import)
 *
 * Returns `null` when the identifier cannot be resolved.
 */
function resolveImportSource(source: string, identifier: string): string | null {
  // Named import: `import { X, Y as Z } from './path'`
  const namedRe = new RegExp(
    String.raw`import\s*(?:type\s+)?\{[^}]*\b${identifier}\b[^}]*\}\s*from\s*['"\`]([^'"\`]+)['"\`]`,
  )
  const named = namedRe.exec(source)
  if (named) return named[1]

  // Default import: `import X from './path'`
  const defaultRe = new RegExp(
    String.raw`import\s+(?:type\s+)?${identifier}\s+from\s*['"\`]([^'"\`]+)['"\`]`,
  )
  const def = defaultRe.exec(source)
  if (def) return def[1]

  // Namespace import: `import * as X from './path'`
  const nsRe = new RegExp(
    String.raw`import\s*\*\s*as\s+${identifier}\s+from\s*['"\`]([^'"\`]+)['"\`]`,
  )
  const ns = nsRe.exec(source)
  if (ns) return ns[1]

  // Same-file const declaration — return empty string as a sentinel meaning
  // "current file". The generator turns this into a self-relative reference.
  const constRe = new RegExp(String.raw`(?:^|\n)\s*(?:export\s+)?const\s+${identifier}\b`)
  if (constRe.test(source)) return ''

  return null
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

    // Two-pass walk: locate each route decorator start, then balance-parse
    // forward through args and any stacked decorators to find the method
    // name. Replaces the previous single regex which mis-parsed nested
    // parens (forinda/kick-js#108).
    ROUTE_DECORATOR_START.lastIndex = 0
    let startMatch: RegExpExecArray | null
    while ((startMatch = ROUTE_DECORATOR_START.exec(block)) !== null) {
      const verb = startMatch[1]
      const decoratorStart = startMatch.index
      const openParen = ROUTE_DECORATOR_START.lastIndex - 1
      const closeParen = findBalancedClose(block, openParen)
      if (closeParen < 0) continue

      const routeArgs = block.slice(openParen + 1, closeParen)

      const pathLiteralMatch = routeArgs.match(/^\s*['"`]([^'"`]*)['"`]/)
      const path = pathLiteralMatch && pathLiteralMatch[1].length > 0 ? pathLiteralMatch[1] : '/'

      const methodInfo = readMethodAfterDecorators(block, closeParen + 1)
      if (!methodInfo) continue
      const { methodName, endPos } = methodInfo

      // Advance the regex iterator past this method so the next iteration
      // starts looking after the consumed region.
      ROUTE_DECORATOR_START.lastIndex = endPos

      const matchedText = block.slice(decoratorStart, endPos)
      const apiQp = extractApiQueryParams(matchedText, source)

      const bodyId = extractObjectFieldIdentifier(routeArgs, 'body')
      const queryId = extractObjectFieldIdentifier(routeArgs, 'query')
      const paramsId = extractObjectFieldIdentifier(routeArgs, 'params')

      out.push({
        controller: cls.className,
        method: methodName,
        httpMethod: verb.toUpperCase() as DiscoveredRoute['httpMethod'],
        path,
        pathParams: extractPathParams(path),
        queryFilterable: apiQp?.filterable ?? null,
        querySortable: apiQp?.sortable ?? null,
        querySearchable: apiQp?.searchable ?? null,
        bodySchema: bodyId
          ? { identifier: bodyId, source: resolveImportSource(source, bodyId) }
          : null,
        querySchema: queryId
          ? { identifier: queryId, source: resolveImportSource(source, queryId) }
          : null,
        paramsSchema: paramsId
          ? { identifier: paramsId, source: resolveImportSource(source, paramsId) }
          : null,
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

/**
 * Default search order for the env schema file. Newer projects keep
 * the schema under `src/config/` so the framework's "config" concept
 * has a single home; older scaffolds dropped it at `src/env.ts` (kept
 * here for back-compat). The first match wins.
 */
const DEFAULT_ENV_FILE_CANDIDATES = [
  'src/config/index.ts',
  'src/config/env.ts',
  'src/config.ts',
  'src/env.ts',
] as const

/**
 * Look for an env schema file. When `envFile` is the string default
 * (`'src/env.ts'`) or omitted, every entry in `DEFAULT_ENV_FILE_CANDIDATES`
 * is tried in order. When the caller passes an explicit path, only that
 * path is tried (so projects can opt out of the search by setting
 * `kick.config.ts → typegen.envFile`).
 *
 * Returns a `DiscoveredEnv` if the file exists and contains both a
 * `defineEnv(...)` call and a default export — the two markers we
 * need before it's safe to emit `import type schema from '...'` in
 * the generator. Returns `null` for any other state (no candidate
 * found, no defineEnv, no default export) so the generator skips env
 * typing silently.
 */
export async function detectEnvFile(cwd: string, envFile: string): Promise<DiscoveredEnv | null> {
  // The CLI passes the literal default `'src/env.ts'` when the user
  // hasn't overridden it. Treat that as "use the search list" rather
  // than pinning to one path, so newer scaffolds at src/config/ keep
  // working without forcing every project to set typegen.envFile.
  const candidates: readonly string[] =
    envFile === 'src/env.ts' ? DEFAULT_ENV_FILE_CANDIDATES : [envFile]

  for (const candidate of candidates) {
    const abs = resolve(cwd, candidate)
    let source: string
    try {
      source = await readFile(abs, 'utf-8')
    } catch {
      continue
    }
    // Cheap heuristic: defineEnv(...) call AND a default export.
    // We don't try to evaluate the file — the generator emits an
    // `import type schema from '...'` and lets the user's tsc do the
    // actual schema-to-type inference.
    if (!/\bdefineEnv\s*\(/.test(source)) continue
    if (!/export\s+default\b/.test(source)) continue
    return {
      filePath: abs,
      relativePath: toRelative(abs, cwd),
    }
  }

  return null
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
  const env = await detectEnvFile(opts.cwd, opts.envFile ?? 'src/env.ts')

  return { classes, routes, tokens, injects, collisions, env }
}
