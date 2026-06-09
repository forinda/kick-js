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
import { ScanCache } from './scanner-cache'

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

/**
 * A plugin or adapter discovered in source — either via `defineAdapter({ name })`
 * / `definePlugin({ name })` calls, or via a class that `implements AppAdapter`
 * and declares a string-literal `name` field.
 *
 * The `name` here is the literal string passed to the framework (the value
 * `dependsOn` references), NOT the symbol on the LHS. `defineAdapter` lets
 * authors choose any name they want; the symbol is irrelevant at runtime.
 */
export interface DiscoveredPluginOrAdapter {
  /** Whether this is a plugin (`definePlugin`) or adapter (`defineAdapter` / class) */
  kind: 'plugin' | 'adapter'
  /** The string literal passed as `name` (the value `dependsOn` references) */
  name: string
  /** Absolute file path */
  filePath: string
  /** Path relative to scan root, with forward slashes */
  relativePath: string
}

/**
 * A context key discovered from a `defineContextDecorator({ key })` or
 * `defineHttpContextDecorator({ key })` call (including the curried
 * `.withParams<P>()({ key })` form). Feeds the `kick/context` typegen
 * plugin, which emits the `ContextKeys` augmentation so `dependsOn`
 * typo-checking is automatic and complete.
 */
export interface DiscoveredContextKey {
  /** The literal `key:` value the contributor writes. */
  key: string
  /** Absolute file path. */
  filePath: string
  /** Path relative to scan root, with forward slashes. */
  relativePath: string
}

/**
 * A `defineAugmentation('Name', meta)` call discovered in source. Plugins
 * call this to advertise an augmentable interface so the typegen can list
 * every augmentation surface in one generated file.
 */
export interface DiscoveredAugmentation {
  /** The literal string passed as the first arg to `defineAugmentation` */
  name: string
  /** Optional `description` extracted from the second-arg object literal */
  description: string | null
  /** Optional `example` extracted from the second-arg object literal */
  example: string | null
  /** Absolute file path */
  filePath: string
  /** Path relative to scan root, with forward slashes */
  relativePath: string
}

/**
 * A decorated class whose file sits inside a module directory but
 * isn't picked up by any of the module's `import.meta.glob(...)`
 * patterns. Surfaced as a typegen warning per forinda/kick-js#235 §4
 * so adopters notice silent registration drift before it bites them
 * at runtime with a `MissingContributorError` or wrong code path.
 */
export interface OrphanedClass {
  /** The decorated class name */
  className: string
  /** Absolute path of the class file */
  filePath: string
  /** Path relative to scan root, with forward slashes */
  relativePath: string
  /** Absolute path of the module file whose globs didn't match */
  moduleFilePath: string
  /** The decorator name (`Service`, `Controller`, `Repository`, …) */
  decorator: DecoratorName
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
  /** Plugins/adapters discovered via `defineAdapter`/`definePlugin`/`implements AppAdapter` */
  pluginsAndAdapters: DiscoveredPluginOrAdapter[]
  /** Augmentation interfaces declared via `defineAugmentation('Name', meta)` */
  augmentations: DiscoveredAugmentation[]
  /** Context keys from `define(Http)ContextDecorator({ key })` calls */
  contextKeys: DiscoveredContextKey[]
  /**
   * Decorated classes that sit inside a module directory but aren't
   * picked up by any of the module's `import.meta.glob(...)` patterns.
   * Empty when every decorator file is matched. forinda/kick-js#235 §4.
   */
  orphanedClasses: OrphanedClass[]
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
  /**
   * Directory for the persistent per-file extraction cache. When set,
   * unchanged files (matched by `mtimeMs:size` signature) are served
   * from `<cacheDir>/scan.json` instead of being re-read and re-scanned.
   * Omit to disable caching (every scan is a cold read — the original
   * behaviour). Typically `<cwd>/.kickjs/cache`.
   */
  cacheDir?: string
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
 * Match an exported class declaration that implements `AppModule`.
 * KickJS modules are not decorated — they implement the `AppModule`
 * interface — so the decorated-class scanner never picks them up. This
 * regex captures them by name so `ModuleToken` can be populated.
 *
 * Tolerates an `extends BaseClass` clause before `implements`, multiple
 * implements clauses (`implements Foo, AppModule`), and `default` exports.
 */
const APP_MODULE_CLASS_REGEX = new RegExp(
  String.raw`export\s+(default\s+)?(?:abstract\s+)?class\s+(\w+)` +
    String.raw`(?:\s+extends\s+\w+(?:<[^>]*>)?)?` +
    String.raw`\s+implements\s+[^{]*\bAppModule\b`,
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

/**
 * Match the start of a `defineAdapter(...)` or `definePlugin(...)` call,
 * tolerating optional `<TConfig, TExtra>` generics. Captures the helper
 * name. The callsite's first-arg object is parsed forward via
 * `findBalancedClose` so nested objects/parens don't confuse us.
 */
const DEFINE_HELPER_START = /\b(defineAdapter|definePlugin)\s*(?:<[^>]*>)?\s*\(/g

/**
 * Match the start of a `defineContextDecorator(...)` /
 * `defineHttpContextDecorator(...)` call up to the `(` that opens the
 * spec object — tolerating optional `<...>` generics AND the curried
 * `.withParams<P>()(...)` form (the empty `()` is consumed so the next
 * `(` is the spec). The spec's `key:` literal is then read forward via
 * `findBalancedClose`, mirroring `DEFINE_HELPER_START`.
 */
// `(?:<(?:[^<>]|<[^<>]*>)*>)?` tolerates one level of nested generics
// (e.g. `defineHttpContextDecorator<'tenant', Record<string, never>>`),
// which a flat `<[^>]*>` would truncate at the inner `>`.
const CONTEXT_DECORATOR_START =
  /\b(?:defineContextDecorator|defineHttpContextDecorator)\s*(?:\.withParams\s*<(?:[^<>]|<[^<>]*>)*>\s*\(\s*\))?\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(/g

/**
 * Match a class declaration whose `implements` clause includes `AppAdapter`.
 * Captures the class name. Used to pick up the (rare, post-defineAdapter)
 * legacy class-style adapters so their literal `name = '...'` field can
 * still feed `KickJsPluginRegistry`.
 */
const APP_ADAPTER_CLASS_REGEX = new RegExp(
  String.raw`export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)` +
    String.raw`(?:\s+extends\s+\w+(?:<[^>]*>)?)?` +
    String.raw`\s+implements\s+[^{]*\bAppAdapter\b`,
  'g',
)

/** Match a string-literal `name = '...'` field on a class body. */
const CLASS_NAME_FIELD_REGEX = /\bname\s*(?::\s*[^=]+)?=\s*['"`]([^'"`]+)['"`]/

/**
 * Match the start of a `defineAugmentation('Name', ...)` call. Captures
 * the literal name. The optional second-arg object is parsed forward so
 * `description` / `example` can be pulled out.
 */
const DEFINE_AUGMENTATION_START = /\bdefineAugmentation\s*\(\s*['"`]([^'"`]+)['"`]\s*(,\s*\{)?/g

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
 * Join a controller's mount-prefix path with a per-route path.
 * Handles the slash edge cases so `'/orgs/:id'` + `'/'` becomes
 * `'/orgs/:id'` (no trailing slash) and `'/orgs/:id'` + `'/:code'`
 * becomes `'/orgs/:id/:code'`. forinda/kick-js#235 §3.
 */
function joinMountPath(mountPath: string, routePath: string): string {
  const prefix = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
  if (!routePath || routePath === '/') return prefix || '/'
  const suffix = routePath.startsWith('/') ? routePath : '/' + routePath
  return prefix + suffix || '/'
}

/**
 * Match the `routes()` method body on a class implementing `AppModule`.
 * Captures the body region so we can scan it for `path:` + `controller:`
 * pairs. Tolerates `routes(): ModuleRoutes` and stripped return type.
 */
const ROUTES_METHOD_START =
  /\b(?:public\s+|private\s+|protected\s+)?routes\s*\([^)]*\)\s*(?::\s*[A-Za-z_][\w<>[\]\s,|]*\s*)?\{/g

/**
 * Match `path: '/...'` inside a routes-method body. Picks up both
 * single-quoted and double-quoted / template literal forms.
 */
const PATH_FIELD_REGEX = /\bpath\s*:\s*['"`]([^'"`]*)['"`]/g

/** Match `controller: SomeController` (bare identifier only). */
const CONTROLLER_FIELD_REGEX = /\bcontroller\s*:\s*([A-Z]\w*)\b/g

/**
 * Match the start of an `import.meta.glob(...)` call. The first arg
 * (string or string array) gets parsed forward via balanced-paren
 * walking to handle whitespace + line breaks inside the array.
 * forinda/kick-js#235 §4.
 */
const IMPORT_META_GLOB_START = /\bimport\.meta\.glob\s*\(/g

/**
 * Extract every glob pattern from `import.meta.glob([...patterns], ...)` calls
 * in a module file. Single-string form (`import.meta.glob('./**\\/*.ts')`) and
 * array form both supported. Negation patterns (`!./**\\/*.test.ts`)
 * are returned with the leading `!` preserved so the caller can apply
 * exclusion logic.
 */
export function extractGlobPatterns(source: string): string[] {
  const patterns: string[] = []
  IMPORT_META_GLOB_START.lastIndex = 0
  while (IMPORT_META_GLOB_START.exec(source) !== null) {
    const openParen = IMPORT_META_GLOB_START.lastIndex - 1
    const closeParen = findBalancedClose(source, openParen)
    if (closeParen < 0) continue
    const args = source.slice(openParen + 1, closeParen)
    // Pull out every string literal inside the first-arg region —
    // we don't bother distinguishing the array form from the bare
    // string; both end up as flat patterns.
    const literalRe = /['"`]([^'"`]+)['"`]/g
    let lit: RegExpExecArray | null
    while ((lit = literalRe.exec(args)) !== null) {
      patterns.push(lit[1] as string)
    }
  }
  return patterns
}

/**
 * Convert a Vite-style glob (e.g. `./**\\/*.controller.ts`) to a
 * RegExp. Supports `**` (any path segments including `/`), `*` (any
 * chars within one segment), `?` (single char). Brace alternation is
 * intentionally not handled — none of the templated globs use it,
 * and a false-negative on an unusual pattern is safer than a false-
 * positive (better to skip the warning than to wrongly silence one).
 */
function globToRegex(pattern: string): RegExp {
  // Process `?` before any of the substitutions that insert `?` into
  // the output (e.g. the `(?:.+/)?` non-capture group for `**/`).
  // If we left it for last, the `?` → `.` pass would mangle those
  // groups into `(.:.+\/).` — broken regex.
  const escaped = pattern
    .replace(/[.+^$()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*\*\//g, '___DOUBLESTAR_SLASH___')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR_SLASH___/g, '(?:.+/)?')
    .replace(/___DOUBLESTAR___/g, '.*')
  return new RegExp('^' + escaped + '$')
}

/**
 * Decide whether a file (relative to the module file's directory)
 * matches any of the module's positive glob patterns. Negation
 * patterns (`!./**\\/*.test.ts`) subtract; a file matched by both a
 * positive and a negation is excluded.
 */
export function fileMatchesAnyGlob(
  moduleRelativePath: string,
  patterns: readonly string[],
): boolean {
  const normalised = moduleRelativePath.startsWith('./')
    ? moduleRelativePath
    : './' + moduleRelativePath
  let matched = false
  for (const pattern of patterns) {
    const isNegation = pattern.startsWith('!')
    const body = isNegation ? pattern.slice(1) : pattern
    if (globToRegex(body).test(normalised)) {
      matched = !isNegation
    }
  }
  return matched
}

/**
 * A `{ controller, mountPath }` pair extracted from a module's
 * `routes()` body. Multiple entries appear when a module returns an
 * array (multi-mount). forinda/kick-js#235 §3.
 */
export interface ModuleMount {
  controller: string
  mountPath: string
}

/**
 * Scan a module file's `routes()` body for `{ path, controller }` pairs.
 * A single return value or an array of return values both work — we
 * regex out every `path: '...'` and every `controller: Ident` and
 * zip them in order. Adopter writing wildly creative bodies won't be
 * matched; that's fine — the scanner falls back to no-mount behaviour
 * (per-route path only) which is the pre-fix behaviour.
 *
 * Returns a list of `{ controller, mountPath }` entries. A controller
 * that appears multiple times in `routes()` (rare; multi-mount
 * version-bundled controllers) gets multiple entries; the route
 * scanner uses the first one for path-param extraction since the
 * pattern usually shares the prefix.
 */
export function extractModuleMounts(source: string): ModuleMount[] {
  const out: ModuleMount[] = []
  ROUTES_METHOD_START.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ROUTES_METHOD_START.exec(source)) !== null) {
    const openBrace = source.indexOf('{', m.index + m[0].length - 1)
    if (openBrace < 0) continue
    const closeBrace = findBalancedBrace(source, openBrace)
    if (closeBrace < 0) continue
    const body = source.slice(openBrace + 1, closeBrace)

    const paths: string[] = []
    PATH_FIELD_REGEX.lastIndex = 0
    let p: RegExpExecArray | null
    while ((p = PATH_FIELD_REGEX.exec(body)) !== null) {
      paths.push(p[1] ?? '')
    }

    const controllers: string[] = []
    CONTROLLER_FIELD_REGEX.lastIndex = 0
    let c: RegExpExecArray | null
    while ((c = CONTROLLER_FIELD_REGEX.exec(body)) !== null) {
      controllers.push(c[1] as string)
    }

    // Zip — if counts mismatch, take the shorter of the two so we
    // never assign a wrong controller to a path.
    const n = Math.min(paths.length, controllers.length)
    for (let i = 0; i < n; i++) {
      out.push({ controller: controllers[i] as string, mountPath: paths[i] as string })
    }
  }
  return out
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

  // KickJS modules are undecorated classes that `implements AppModule`.
  // Tag them with the synthetic `Module` decorator so downstream code that
  // already filters by `c.decorator === 'Module'` keeps working.
  APP_MODULE_CLASS_REGEX.lastIndex = 0
  let modMatch: RegExpExecArray | null
  while ((modMatch = APP_MODULE_CLASS_REGEX.exec(source)) !== null) {
    const [, defaultMarker, className] = modMatch
    if (out.some((c) => c.className === className && c.filePath === filePath)) continue
    out.push({
      className,
      decorator: 'Module',
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
  mountPathByController: ReadonlyMap<string, string> = new Map(),
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

      // forinda/kick-js#235 §3 — when the controller is mounted under a path
      // with `:params` (e.g. `/orgs/:id/extensions`), surface those
      // params in `pathParams` so the typegen widens `ctx.params`
      // without adopters repeating `params: schema` on every route.
      const mountPath = mountPathByController.get(cls.className) ?? ''
      const fullPath = mountPath ? joinMountPath(mountPath, path) : path

      out.push({
        controller: cls.className,
        method: methodName,
        httpMethod: verb.toUpperCase() as DiscoveredRoute['httpMethod'],
        path,
        pathParams: extractPathParams(fullPath),
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
 * Extract the bounds of an object literal that begins at `openBracePos`
 * (the index of the `{` character). Returns the index of the matching `}`
 * or -1 if no match is found. Counts balanced braces only — does not
 * understand string literals so a `{` or `}` inside a string inside the
 * object will skew the depth counter (matches `findBalancedClose`).
 */
function findBalancedBrace(text: string, openBracePos: number): number {
  let depth = 1
  for (let i = openBracePos + 1; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Extract plugins/adapters declared via `defineAdapter({ name: '...' })`
 * or `definePlugin({ name: '...' })` calls and via class-style adapters
 * (`class XxxAdapter implements AppAdapter` with a string-literal `name`
 * field).
 *
 * Only the literal `name:` field feeds the result — the symbol on the LHS
 * is irrelevant since `dependsOn` references the runtime name.
 */
export function extractPluginsAndAdaptersFromSource(
  source: string,
  filePath: string,
  cwd: string,
): DiscoveredPluginOrAdapter[] {
  const out: DiscoveredPluginOrAdapter[] = []
  const relPath = toRelative(filePath, cwd)
  const seen = new Set<string>()

  // Pass 1: defineAdapter / definePlugin calls
  DEFINE_HELPER_START.lastIndex = 0
  let helperMatch: RegExpExecArray | null
  while ((helperMatch = DEFINE_HELPER_START.exec(source)) !== null) {
    const helper = helperMatch[1] as 'defineAdapter' | 'definePlugin'
    const openParen = DEFINE_HELPER_START.lastIndex - 1
    const closeParen = findBalancedClose(source, openParen)
    if (closeParen < 0) continue
    const callArgs = source.slice(openParen + 1, closeParen)
    // Look for the first `name: 'literal'` in the call args
    const nameMatch = /\bname\s*:\s*['"`]([^'"`]+)['"`]/.exec(callArgs)
    if (!nameMatch) continue
    const name = nameMatch[1]
    const dedupeKey = `${helper}::${name}::${filePath}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push({
      kind: helper === 'definePlugin' ? 'plugin' : 'adapter',
      name,
      filePath,
      relativePath: relPath,
    })
  }

  // Pass 2: class-style adapters (`class X implements AppAdapter { name = 'X' }`)
  APP_ADAPTER_CLASS_REGEX.lastIndex = 0
  let classMatch: RegExpExecArray | null
  while ((classMatch = APP_ADAPTER_CLASS_REGEX.exec(source)) !== null) {
    const classStart = classMatch.index
    // Find the class body opening brace
    const bracePos = source.indexOf('{', classStart)
    if (bracePos < 0) continue
    const closeBrace = findBalancedBrace(source, bracePos)
    if (closeBrace < 0) continue
    const body = source.slice(bracePos + 1, closeBrace)
    const nameMatch = CLASS_NAME_FIELD_REGEX.exec(body)
    if (!nameMatch) continue
    const name = nameMatch[1]
    const dedupeKey = `class::${name}::${filePath}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push({ kind: 'adapter', name, filePath, relativePath: relPath })
  }

  return out
}

/**
 * Extract context keys from `defineContextDecorator({ key: '...' })` and
 * `defineHttpContextDecorator({ key: '...' })` calls (including the
 * curried `.withParams<P>()({ key: '...' })` form). Only the literal
 * `key:` field feeds the result — the symbol on the LHS is irrelevant
 * since `dependsOn` references the runtime key string.
 *
 * Mirrors {@link extractPluginsAndAdaptersFromSource}: regex to the spec
 * object's opening paren, `findBalancedClose` to its end, then the first
 * `key: 'literal'` inside.
 */
export function extractContextKeysFromSource(
  source: string,
  filePath: string,
  cwd: string,
): DiscoveredContextKey[] {
  const out: DiscoveredContextKey[] = []
  const relPath = toRelative(filePath, cwd)
  const seen = new Set<string>()

  CONTEXT_DECORATOR_START.lastIndex = 0
  // The match value itself is unused — we only need the loop to advance
  // and `lastIndex` to point just past the spec's opening paren.
  while (CONTEXT_DECORATOR_START.exec(source) !== null) {
    const openParen = CONTEXT_DECORATOR_START.lastIndex - 1
    const closeParen = findBalancedClose(source, openParen)
    if (closeParen < 0) continue
    const callArgs = source.slice(openParen + 1, closeParen)
    const keyMatch = /\bkey\s*:\s*['"`]([^'"`]+)['"`]/.exec(callArgs)
    if (!keyMatch) continue
    const key = keyMatch[1]
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, filePath, relativePath: relPath })
  }

  return out
}

/**
 * Extract `defineAugmentation('Name', { description, example })` calls
 * from a source file. The metadata object is optional — when absent both
 * `description` and `example` resolve to `null`.
 */
export function extractAugmentationsFromSource(
  source: string,
  filePath: string,
  cwd: string,
): DiscoveredAugmentation[] {
  const out: DiscoveredAugmentation[] = []
  const relPath = toRelative(filePath, cwd)

  DEFINE_AUGMENTATION_START.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DEFINE_AUGMENTATION_START.exec(source)) !== null) {
    const name = match[1]
    let description: string | null = null
    let example: string | null = null

    // If the regex matched a metadata object opening (`, {`), parse it
    if (match[2]) {
      const bracePos = source.indexOf('{', match.index + match[0].length - 1)
      if (bracePos >= 0) {
        const closeBrace = findBalancedBrace(source, bracePos)
        if (closeBrace >= 0) {
          const body = source.slice(bracePos + 1, closeBrace)
          description = readStringField(body, 'description')
          example = readStringField(body, 'example')
        }
      }
    }

    out.push({ name, description, example, filePath, relativePath: relPath })
  }

  return out
}

/**
 * Pull a string-valued field out of a JS object-literal body, respecting
 * the opening quote so the value isn't truncated at the first foreign
 * quote character. Handles backslash escapes inside the literal.
 *
 * Why a custom parser instead of one regex per delimiter: real-world
 * `defineAugmentation` calls embed all three quote characters at once
 * — backtick template literals carrying TS shapes like
 * `'free' | 'pro'` (single quotes) AND `\`ctx.get(...)\`` (escaped
 * backticks). A character-class regex like `[^'"`]+` truncates on the
 * first foreign quote it sees. This walker scans char-by-char from
 * the matched delimiter and only stops on the matching one.
 */
function readStringField(body: string, field: string): string | null {
  // Locate `field:` followed by an opening quote. Tolerate any whitespace.
  const fieldRe = new RegExp(`\\b${field}\\s*:\\s*(['"\`])`, 'g')
  const m = fieldRe.exec(body)
  if (!m) return null
  const quote = m[1]
  const start = m.index + m[0].length
  let i = start
  let raw: string | null = null
  while (i < body.length) {
    const ch = body[i]
    if (ch === '\\') {
      // Skip the escaped char — supports \`, \', \", \n, \\ etc.
      i += 2
      continue
    }
    if (ch === quote) {
      raw = body.slice(start, i)
      break
    }
    i++
  }
  if (raw === null) return null
  // Unescape JS string-literal escapes so the JSDoc renderer sees the
  // value the source author actually intended (`\`` → `` ` ``, `\'` →
  // `'`, etc). Without this, escaped backticks in a backtick template
  // literal would surface as literal backslashes in the catalogue.
  return raw.replace(/\\(.)/g, (_m, c) => {
    if (c === 'n') return '\n'
    if (c === 't') return '\t'
    if (c === 'r') return '\r'
    return c
  })
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
    // Cheap heuristic: a schema-construction call AND a default
    // export. The default export must be the SCHEMA itself — the
    // generator emits `import type schema from '...'` and runs it
    // through schema-to-type inference. `loadEnvFromSchema(...)` is
    // deliberately NOT in the accept list because its return value is
    // the parsed env object, not the schema. Adopters routinely write
    //   export default envSchema
    //   export const env = loadEnvFromSchema(envSchema)
    // where only `envSchema` is the schema; detecting on
    // `loadEnvFromSchema` would also accept the anti-pattern
    //   export default loadEnvFromSchema(schema)
    // which would push the parsed *env value* into `InferSchemaOutput`
    // and emit a broken `KickEnv`.
    //
    // Accept lists:
    //   - `defineEnv(...)`                       — legacy Zod scaffold
    //   - `fromZod / fromValibot / fromYup(...)` — kickjs-schema adapters
    if (!/\bdefineEnv\s*\(/.test(source) && !/\bfrom(Zod|Valibot|Yup)\s*\(/.test(source)) {
      continue
    }
    if (!/export\s+default\b/.test(source)) continue
    // Reject the "default-export is the parsed env" pattern
    // explicitly. Without this guard, a file that constructs the
    // schema with `fromZod(...)` and then does
    // `export default loadEnvFromSchema(envSchema)` would slip past
    // the schema-construction check above and feed the parsed env's
    // value type into `InferSchemaOutput`.
    if (/export\s+default\s+loadEnvFromSchema\s*\(/.test(source)) continue
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
 * The complete per-file extraction result. Every field here is a pure
 * function of a single file's source text — no cross-file context — so
 * the whole object is cacheable keyed by the file's signature.
 *
 * The one subtlety is `routes`: their `pathParams` are computed with an
 * EMPTY mount map (own-path params only). The cross-file mount prefix
 * is re-applied during the join phase of `scanProject`, which is a
 * cheap pure-JS recompute (no regex, no I/O). This keeps routes fully
 * cacheable even though their final `pathParams` depend on a sibling
 * module file's `routes()` mount path.
 */
export interface FileExtract {
  classes: DiscoveredClass[]
  tokens: DiscoveredToken[]
  injects: DiscoveredInject[]
  pluginsAndAdapters: DiscoveredPluginOrAdapter[]
  augmentations: DiscoveredAugmentation[]
  contextKeys: DiscoveredContextKey[]
  /** Routes with own-path `pathParams` only — mount prefix applied at join. */
  routes: DiscoveredRoute[]
  /** `{ controller, mountPath }` pairs from this file's `routes()` body. */
  moduleMounts: ModuleMount[]
  /** `import.meta.glob([...])` patterns (only non-empty for `*.module.ts`). */
  globPatterns: string[]
}

/**
 * Run every per-file extractor over one source string. Pure: depends
 * only on the file's own text, so the result is safe to cache by
 * filesystem signature (see `scanner-cache.ts`).
 */
export function extractFile(source: string, filePath: string, cwd: string): FileExtract {
  const classes = extractClassesFromSource(source, filePath, cwd)
  return {
    classes,
    tokens: extractTokensFromSource(source, filePath, cwd),
    injects: extractInjectsFromSource(source, filePath, cwd),
    pluginsAndAdapters: extractPluginsAndAdaptersFromSource(source, filePath, cwd),
    augmentations: extractAugmentationsFromSource(source, filePath, cwd),
    contextKeys: extractContextKeysFromSource(source, filePath, cwd),
    // Empty mount map → own-path params only; prefix re-applied at join.
    routes: extractRoutesFromSource(source, filePath, cwd, classes, new Map()),
    moduleMounts: extractModuleMounts(source),
    globPatterns: /\.module\.[mc]?[tj]sx?$/.test(filePath) ? extractGlobPatterns(source) : [],
  }
}

/**
 * Read + extract a single file, consulting the optional persistent
 * cache first. On a signature hit the file is not read at all — the
 * cached extract is returned directly. Returns null when the file
 * cannot be read (deleted mid-scan / permission error).
 */
async function loadFileExtract(
  file: string,
  cwd: string,
  cache: ScanCache | null,
): Promise<FileExtract | null> {
  const sig = cache ? await ScanCache.signature(file) : null
  if (cache && sig) {
    const hit = cache.get(file, sig)
    if (hit) {
      cache.set(file, sig, hit)
      return hit
    }
  }
  let source: string
  try {
    source = await readFile(file, 'utf-8')
  } catch {
    return null
  }
  const extract = extractFile(source, file, cwd)
  if (cache && sig) cache.set(file, sig, extract)
  return extract
}

/** Map a concurrency-bounded async fn over items, preserving order. */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = []
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * Scan a project for decorated classes, createToken definitions, and
 * `@Inject` literal usages.
 *
 * Per-file extraction is read + parsed concurrently and, when
 * `opts.cacheDir` is set, served from a persistent signature cache so
 * unchanged files are never re-read on a watch/rebuild. The cross-file
 * join phase (mount-prefix resolution, orphan detection) always runs
 * over the full extract set, so cached entries can never desync output.
 */
export async function scanProject(opts: ScanOptions): Promise<ScanResult> {
  const root = resolve(opts.root)
  const files = await walk(root, opts)

  const cache = opts.cacheDir ? await ScanCache.load(opts.cacheDir) : null

  // Concurrent read + per-file extraction (cache-aware). I/O-bound, so
  // a modest fan-out hides per-file latency without thrashing the FD
  // table. Order is preserved for deterministic downstream iteration.
  const extracts = await mapConcurrent(files, 16, (file) => loadFileExtract(file, opts.cwd, cache))

  const joined = joinExtracts(files, extracts)
  const env = await detectEnvFile(opts.cwd, opts.envFile ?? 'src/env.ts')

  // Persist the refreshed cache (prunes entries for deleted files).
  if (cache) await cache.save()

  return { ...joined, env }
}

/** A precise set of filesystem changes, as reported by a watcher. */
export interface ScanDelta {
  /** Files added or modified since the last scan (absolute or cwd-relative). */
  changed: string[]
  /** Files deleted since the last scan. */
  removed: string[]
}

/**
 * Does `file` belong in the scan? Mirrors `walk()`'s ext + exclude
 * filtering so a watcher event for a `.d.ts`, a test, or a node_modules
 * file is ignored just as the full walk would ignore it.
 */
function isScannableFile(file: string, root: string, opts: ScanOptions): boolean {
  const exts = opts.extensions ?? DEFAULT_EXTENSIONS
  const excludes = opts.exclude ?? DEFAULT_EXCLUDES
  if (!file.startsWith(root + sep) && file !== root) return false
  if (!exts.some((ext) => file.endsWith(ext))) return false
  const rel = relative(opts.cwd, file)
  if (excludes.some((ex) => rel.includes(ex))) return false
  return true
}

/**
 * Incremental scan driven by an exact watcher delta (e.g. Vite's
 * chokidar events). Unlike `scanProject` this performs NO directory
 * walk and NO `stat()` of unchanged files: it loads the persistent
 * cache, re-extracts only the `changed` files, drops `removed` ones,
 * and re-runs the cheap cross-file join over the resulting set.
 *
 * Requires a warm cache. With no `cacheDir`, an empty cache (cold
 * start), it transparently falls back to a full `scanProject` so the
 * caller never has to special-case the first run.
 */
export async function scanProjectIncremental(
  opts: ScanOptions,
  delta: ScanDelta,
): Promise<ScanResult> {
  if (!opts.cacheDir) return scanProject(opts)
  const root = resolve(opts.root)
  const cache = await ScanCache.load(opts.cacheDir)
  const cachedFiles = cache.cachedFiles()
  if (cachedFiles.length === 0) return scanProject(opts)

  const removed = new Set(delta.removed.map((f) => resolve(opts.cwd, f)))
  const changed = delta.changed
    .map((f) => resolve(opts.cwd, f))
    .filter((f) => !removed.has(f) && isScannableFile(f, root, opts))
  const changedSet = new Set(changed)

  // Working set = (previously cached ∪ newly added) − removed.
  const working = new Set(cachedFiles)
  for (const f of changedSet) working.add(f)
  for (const f of removed) working.delete(f)

  // Re-extract only the changed files (concurrent). Everything else is
  // served from the cache without a read or a stat.
  const fresh = new Map<string, FileExtract>()
  await mapConcurrent(changed, 16, async (file) => {
    if (!working.has(file)) return
    const sig = await ScanCache.signature(file)
    let source: string
    try {
      source = await readFile(file, 'utf-8')
    } catch {
      working.delete(file)
      return
    }
    const extract = extractFile(source, file, opts.cwd)
    fresh.set(file, extract)
    if (sig) cache.set(file, sig, extract)
  })

  const orderedFiles = [...working].toSorted()
  const extracts = orderedFiles.map((file) => {
    const f = fresh.get(file)
    if (f) return f
    cache.carry(file) // keep the unchanged entry in the next saved cache
    return cache.peek(file)
  })

  const joined = joinExtracts(orderedFiles, extracts)
  const env = await detectEnvFile(opts.cwd, opts.envFile ?? 'src/env.ts')
  await cache.save()

  return { ...joined, env }
}

/**
 * Cross-file join over a set of per-file extracts: resolves mount-prefix
 * route params, detects glob-orphaned classes, concatenates and sorts
 * every discovered entity into a deterministic `ScanResult` (minus the
 * async `env` field, which the caller attaches). Pure and synchronous —
 * shared by both `scanProject` and `scanProjectIncremental`.
 */
function joinExtracts(files: string[], extracts: (FileExtract | null)[]): Omit<ScanResult, 'env'> {
  const classes: DiscoveredClass[] = []
  const routes: DiscoveredRoute[] = []
  const tokens: DiscoveredToken[] = []
  const injects: DiscoveredInject[] = []
  const pluginsAndAdapters: DiscoveredPluginOrAdapter[] = []
  const augmentations: DiscoveredAugmentation[] = []
  const contextKeys: DiscoveredContextKey[] = []

  // forinda/kick-js#235 §3 — build a `Controller → mountPath` map from every
  // module file's `routes()` body so per-route `pathParams` can include
  // the prefix params (e.g. `/orgs/:id`) without adopters re-declaring
  // `params:` on every method. First mount wins on duplicates (rare
  // multi-mount controllers — typically share the prefix shape).
  const mountPathByController = new Map<string, string>()
  for (const extract of extracts) {
    if (!extract) continue
    for (const { controller, mountPath } of extract.moduleMounts) {
      if (!mountPathByController.has(controller)) {
        mountPathByController.set(controller, mountPath)
      }
    }
  }

  // A per-file glob-pattern map drives the §4 orphan pass below without
  // re-reading module sources.
  const globPatternsByFile = new Map<string, string[]>()
  for (let i = 0; i < files.length; i++) {
    const extract = extracts[i]
    if (!extract) continue
    classes.push(...extract.classes)
    tokens.push(...extract.tokens)
    injects.push(...extract.injects)
    pluginsAndAdapters.push(...extract.pluginsAndAdapters)
    augmentations.push(...extract.augmentations)
    contextKeys.push(...extract.contextKeys)
    if (extract.globPatterns.length > 0) globPatternsByFile.set(files[i], extract.globPatterns)

    // Re-apply the cross-file mount prefix to each cached route's
    // pathParams. Routes were extracted with an empty mount map, so
    // their pathParams currently carry own-path params only.
    for (const route of extract.routes) {
      const mountPath = mountPathByController.get(route.controller)
      if (mountPath) {
        const fullPath = joinMountPath(mountPath, route.path)
        routes.push({ ...route, pathParams: extractPathParams(fullPath) })
      } else {
        routes.push(route)
      }
    }
  }

  // forinda/kick-js#235 §4 — for every module file, extract its
  // `import.meta.glob([...])` patterns and flag any decorated class
  // whose file sits inside the module directory but isn't matched by
  // a positive pattern. Catches the "added a new file type, forgot to
  // extend the glob" silent-degradation case.
  // Normalize Windows backslashes to forward slashes before any
  // slicing / startsWith / glob-matching — the rest of the scanner
  // already speaks forward-slash relative paths, but absolute
  // `filePath` values may carry the platform separator on Windows.
  const orphanedClasses: OrphanedClass[] = []
  for (const [moduleFile, patterns] of globPatternsByFile) {
    if (!/\.module\.[mc]?[tj]sx?$/.test(moduleFile)) continue
    if (patterns.length === 0) continue
    const moduleFilePosix = moduleFile.replaceAll(sep, '/')
    const moduleDir = moduleFilePosix.slice(0, moduleFilePosix.lastIndexOf('/'))
    for (const cls of classes) {
      // Skip module files themselves — they're scanner-synthesized
      // `decorator: 'Module'` entries that aren't glob contributors.
      if (cls.decorator === 'Module') continue
      const classFilePosix = cls.filePath.replaceAll(sep, '/')
      if (!classFilePosix.startsWith(moduleDir + '/')) continue
      if (classFilePosix === moduleFilePosix) continue
      const moduleRelative = classFilePosix.slice(moduleDir.length + 1)
      if (!fileMatchesAnyGlob(moduleRelative, patterns)) {
        orphanedClasses.push({
          className: cls.className,
          filePath: cls.filePath,
          relativePath: cls.relativePath,
          moduleFilePath: moduleFile,
          decorator: cls.decorator,
        })
      }
    }
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
  pluginsAndAdapters.sort(
    (a, b) => a.name.localeCompare(b.name) || a.relativePath.localeCompare(b.relativePath),
  )
  augmentations.sort(
    (a, b) => a.name.localeCompare(b.name) || a.relativePath.localeCompare(b.relativePath),
  )
  contextKeys.sort(
    (a, b) => a.key.localeCompare(b.key) || a.relativePath.localeCompare(b.relativePath),
  )

  const collisions = findCollisions(classes)

  orphanedClasses.sort(
    (a, b) =>
      a.relativePath.localeCompare(b.relativePath) || a.className.localeCompare(b.className),
  )

  return {
    classes,
    routes,
    tokens,
    injects,
    collisions,
    pluginsAndAdapters,
    augmentations,
    contextKeys,
    orphanedClasses,
  }
}
