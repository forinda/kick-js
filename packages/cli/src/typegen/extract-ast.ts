/**
 * AST-based per-file extraction — oxc-parser replacement for the regex
 * extractors in `scanner.ts`.
 *
 * Produces the exact same {@link FileExtract} shape so the scanner's
 * cache / incremental / cross-file-join machinery is untouched. The
 * scanner calls {@link extractFileAst} first and falls back to the
 * regex path when the file doesn't parse (mid-edit syntax errors in
 * watch mode — regex still salvages partial results there).
 *
 * What AST extraction fixes over the regex path (forinda/kick-js#108):
 *   - template-literal route paths (`@Get(\`/v1/users/:id\`)`) — regex
 *     silently fell back to `/`
 *   - nested parens/braces inside stacked decorator args
 *   - string literals containing `(`/`)`/`{`/`}` skewing the
 *     balanced-delimiter walkers
 *   - aliased named imports in schema-ref resolution
 *
 * Everything here is pure (depends only on the source text), so results
 * stay safe to cache by filesystem signature.
 */
import { relative, sep } from 'node:path'

import { parseSync } from 'oxc-parser'

import {
  DECORATOR_NAMES,
  type DecoratorName,
  type DiscoveredAugmentation,
  type DiscoveredClass,
  type DiscoveredContextKey,
  type DiscoveredInject,
  type DiscoveredPluginOrAdapter,
  type DiscoveredRoute,
  type DiscoveredToken,
  type FileExtract,
  type ModuleMount,
  type SchemaRef,
} from './scanner'

// scanner.ts ⇄ extract-ast.ts is an import cycle (scanner calls
// extractFileAst; we need its DECORATOR_NAMES). Type imports are erased,
// but reading the DECORATOR_NAMES *value* during this module's init
// would hit the TDZ while scanner is still evaluating — so the set is
// built lazily on first extraction instead.
let decoratorNameSet: Set<string> | null = null
function getDecoratorNameSet(): Set<string> {
  decoratorNameSet ??= new Set<string>(DECORATOR_NAMES)
  return decoratorNameSet
}

// oxc-parser returns ESTree-shaped plain objects. We walk them
// structurally; a tiny structural node type keeps us honest without
// pulling in the full @oxc-project/types surface.
interface Node {
  type: string
  [key: string]: unknown
}

const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch'])

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string'
}

/** Depth-first walk over every AST node (objects with a string `type`). */
function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (!isNode(node)) return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'type') continue
    const value = node[key]
    if (typeof value === 'object' && value !== null) walk(value, visit)
  }
}

/** Static string value of a literal / no-substitution template, else null. */
function stringValue(node: unknown): string | null {
  if (!isNode(node)) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral') {
    const quasis = node.quasis as Node[] | undefined
    const expressions = node.expressions as unknown[] | undefined
    if (quasis?.length === 1 && (expressions?.length ?? 0) === 0) {
      const cooked = (quasis[0] as { value?: { cooked?: string } }).value?.cooked
      return typeof cooked === 'string' ? cooked : null
    }
  }
  return null
}

function identifierName(node: unknown): string | null {
  return isNode(node) && node.type === 'Identifier' ? (node.name as string) : null
}

/** Callee name for `name(...)` calls (plain identifier callees only). */
function calleeName(call: Node): string | null {
  return identifierName(call.callee)
}

/** Object-literal property lookup by static key name. */
function getProp(obj: Node | null, name: string): Node | null {
  if (!obj || obj.type !== 'ObjectExpression') return null
  for (const prop of (obj.properties as Node[] | undefined) ?? []) {
    if (prop.type !== 'Property') continue
    const key = prop.key as Node
    const keyName =
      identifierName(key) ?? (key.type === 'Literal' ? String(key.value) : stringValue(key))
    if (keyName === name) return prop.value as Node
  }
  return null
}

/** First argument when it's an object literal, else null. */
function firstObjectArg(call: Node): Node | null {
  const arg = (call.arguments as Node[] | undefined)?.[0]
  return isNode(arg) && arg.type === 'ObjectExpression' ? arg : null
}

function extractStringArrayProp(obj: Node | null, key: string): string[] {
  const value = getProp(obj, key)
  if (!isNode(value) || value.type !== 'ArrayExpression') return []
  const out: string[] = []
  for (const el of (value.elements as unknown[] | undefined) ?? []) {
    const s = stringValue(el)
    if (s !== null) out.push(s)
  }
  return out
}

function toRelative(filePath: string, cwd: string): string {
  return relative(cwd, filePath).split(sep).join('/')
}

function extractPathParams(path: string): string[] {
  const matches = path.match(/:([a-zA-Z_]\w*)/g) ?? []
  return matches.map((m) => m.slice(1))
}

/** Mirrors scanner.ts joinMountPath — slash-edge handling for #235 §3. */
function joinMountPath(mountPath: string, routePath: string): string {
  const prefix = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
  if (!routePath || routePath === '/') return prefix || '/'
  const suffix = routePath.startsWith('/') ? routePath : '/' + routePath
  return prefix + suffix || '/'
}

/** `implements` clause includes `name`? */
function classImplements(cls: Node, name: string): boolean {
  for (const impl of (cls.implements as Node[] | undefined) ?? []) {
    const expr = (impl.expression ?? impl) as Node
    if (identifierName(expr) === name) return true
    // Qualified form (`kick.AppModule`) — match the rightmost segment.
    if (expr.type === 'TSQualifiedName' || expr.type === 'MemberExpression') {
      const right = (expr.right ?? expr.property) as Node | undefined
      if (right && identifierName(right) === name) return true
    }
  }
  return false
}

/** Decorators attached to a class / method / property / param node. */
function decoratorsOf(node: Node): Node[] {
  return (node.decorators as Node[] | undefined) ?? []
}

/** `@Name(...)` decorator → { name, call } (call-expression form only). */
function decoratorCall(dec: Node): { name: string; call: Node } | null {
  const expr = dec.expression as Node
  if (!isNode(expr) || expr.type !== 'CallExpression') return null
  const name = calleeName(expr)
  return name ? { name, call: expr } : null
}

interface ImportBinding {
  source: string
}

/**
 * Per-file context shared by the extract passes: import map (local
 * binding name → module specifier) and the set of top-level const names
 * (same-file schema refs resolve to the `''` sentinel).
 */
interface FileContext {
  imports: Map<string, ImportBinding>
  topLevelConsts: Set<string>
}

function buildFileContext(program: Node): FileContext {
  const imports = new Map<string, ImportBinding>()
  const topLevelConsts = new Set<string>()
  for (const stmt of (program.body as Node[] | undefined) ?? []) {
    if (stmt.type === 'ImportDeclaration') {
      const source = stringValue(stmt.source) ?? ''
      for (const spec of (stmt.specifiers as Node[] | undefined) ?? []) {
        const local = identifierName(spec.local)
        if (local) imports.set(local, { source })
      }
      continue
    }
    // `const X = ...` / `export const X = ...` at top level
    const decl =
      stmt.type === 'VariableDeclaration'
        ? stmt
        : stmt.type === 'ExportNamedDeclaration' && isNode(stmt.declaration)
          ? (stmt.declaration as Node)
          : null
    if (isNode(decl) && decl.type === 'VariableDeclaration') {
      for (const d of (decl.declarations as Node[] | undefined) ?? []) {
        const name = identifierName(d.id)
        if (name) topLevelConsts.add(name)
      }
    }
  }
  return { imports, topLevelConsts }
}

/**
 * Mirror of scanner.ts `resolveImportSource` semantics on top of the
 * AST import map: imported → module specifier, same-file const → `''`
 * sentinel, otherwise null.
 */
function resolveSchemaRef(identifier: string, ctx: FileContext): SchemaRef {
  const imported = ctx.imports.get(identifier)
  if (imported) return { identifier, source: imported.source }
  if (ctx.topLevelConsts.has(identifier)) return { identifier, source: '' }
  return { identifier, source: null }
}

/** Schema field (`body:` / `query:` / `params:`) — bare identifiers only. */
function schemaFieldRef(options: Node | null, field: string, ctx: FileContext): SchemaRef | null {
  const value = getProp(options, field)
  const name = identifierName(value)
  return name ? resolveSchemaRef(name, ctx) : null
}

interface QueryParamsConfig {
  filterable: string[]
  sortable: string[]
  searchable: string[]
}

/**
 * `@ApiQueryParams(...)` on a method — inline object literal or a
 * same-file const reference. Present-but-opaque (imported config,
 * column-object map, function call) → empty arrays, mirroring the
 * regex path's "decorator exists but nothing statically extractable".
 */
function extractApiQueryParams(
  methodDecorators: Node[],
  topLevelConstInits: Map<string, Node>,
): QueryParamsConfig | null {
  for (const dec of methodDecorators) {
    const dc = decoratorCall(dec)
    if (!dc || dc.name !== 'ApiQueryParams') continue
    const arg = (dc.call.arguments as Node[] | undefined)?.[0]
    let obj: Node | null = null
    if (isNode(arg) && arg.type === 'ObjectExpression') {
      obj = arg
    } else {
      const refName = identifierName(arg)
      if (refName) {
        const init = topLevelConstInits.get(refName)
        if (init && init.type === 'ObjectExpression') obj = init
      }
    }
    return {
      filterable: extractStringArrayProp(obj, 'filterable'),
      sortable: extractStringArrayProp(obj, 'sortable'),
      searchable: extractStringArrayProp(obj, 'searchable'),
    }
  }
  return null
}

/**
 * Parse + extract one source file. Returns `null` when oxc reports
 * parse errors — the caller falls back to the regex extractors, which
 * tolerate broken mid-edit sources by matching whatever still looks
 * right.
 */
export function extractFileAst(source: string, filePath: string, cwd: string): FileExtract | null {
  let program: Node
  try {
    const result = parseSync(filePath, source)
    if (result.errors.length > 0) return null
    program = result.program as unknown as Node
  } catch {
    return null
  }

  const relPath = toRelative(filePath, cwd)
  const ctx = buildFileContext(program)

  const classes: DiscoveredClass[] = []
  const tokens: DiscoveredToken[] = []
  const injects: DiscoveredInject[] = []
  const pluginsAndAdapters: DiscoveredPluginOrAdapter[] = []
  const augmentations: DiscoveredAugmentation[] = []
  const contextKeys: DiscoveredContextKey[] = []
  const routes: DiscoveredRoute[] = []
  const moduleMounts: ModuleMount[] = []
  const globPatterns: string[] = []

  const seenHelperNames = new Set<string>()
  const seenContextKeys = new Set<string>()
  const seenTokenNodes = new Set<Node>()
  /** Top-level `const X = <init>` map for @ApiQueryParams const refs. */
  const topLevelConstInits = new Map<string, Node>()

  for (const stmt of (program.body as Node[] | undefined) ?? []) {
    const decl =
      stmt.type === 'VariableDeclaration'
        ? stmt
        : stmt.type === 'ExportNamedDeclaration' && isNode(stmt.declaration)
          ? (stmt.declaration as Node)
          : null
    if (isNode(decl) && decl.type === 'VariableDeclaration') {
      for (const d of (decl.declarations as Node[] | undefined) ?? []) {
        const name = identifierName(d.id)
        if (name && isNode(d.init)) topLevelConstInits.set(name, d.init as Node)
      }
    }
  }

  // ── Pass 1: top-level statements — classes + defineModule consts ──────
  const exportedClasses: Array<{ cls: Node; isDefault: boolean }> = []
  for (const stmt of (program.body as Node[] | undefined) ?? []) {
    if (stmt.type === 'ExportNamedDeclaration' && isNode(stmt.declaration)) {
      const d = stmt.declaration as Node
      if (d.type === 'ClassDeclaration') exportedClasses.push({ cls: d, isDefault: false })
    } else if (stmt.type === 'ExportDefaultDeclaration' && isNode(stmt.declaration)) {
      const d = stmt.declaration as Node
      if (d.type === 'ClassDeclaration') exportedClasses.push({ cls: d, isDefault: true })
    }
  }

  for (const { cls, isDefault } of exportedClasses) {
    const className = identifierName(cls.id)
    if (!className) continue

    // First call-form decorator whose name is in DECORATOR_NAMES — same
    // pick as the regex (first in the stack wins).
    let tagged: DecoratorName | null = null
    for (const dec of decoratorsOf(cls)) {
      const dc = decoratorCall(dec)
      if (dc && getDecoratorNameSet().has(dc.name)) {
        tagged = dc.name as DecoratorName
        break
      }
    }
    if (tagged) {
      classes.push({ className, decorator: tagged, filePath, relativePath: relPath, isDefault })
    } else if (classImplements(cls, 'AppModule')) {
      classes.push({
        className,
        decorator: 'Module',
        filePath,
        relativePath: relPath,
        isDefault,
      })
    }
  }

  // v4 factory modules: `export const XModule = defineModule({...})`
  for (const stmt of (program.body as Node[] | undefined) ?? []) {
    if (stmt.type !== 'ExportNamedDeclaration' || !isNode(stmt.declaration)) continue
    const d = stmt.declaration as Node
    if (d.type !== 'VariableDeclaration') continue
    for (const declarator of (d.declarations as Node[] | undefined) ?? []) {
      const name = identifierName(declarator.id)
      const init = declarator.init as Node | undefined
      if (!name || !isNode(init) || init.type !== 'CallExpression') continue
      if (calleeName(init) !== 'defineModule') continue
      if (classes.some((c) => c.className === name)) continue
      classes.push({
        className: name,
        decorator: 'Module',
        filePath,
        relativePath: relPath,
        isDefault: false,
      })
    }
  }

  // ── Pass 2: whole-tree walk — tokens, injects, helpers, globs ─────────
  walk(program, (node) => {
    // createToken('name') — const-bound (variable) or bare (null)
    if (node.type === 'VariableDeclarator') {
      const init = node.init as Node | undefined
      if (isNode(init) && init.type === 'CallExpression' && calleeName(init) === 'createToken') {
        const name = stringValue((init.arguments as Node[] | undefined)?.[0])
        if (name !== null) {
          seenTokenNodes.add(init)
          tokens.push({
            name,
            variable: identifierName(node.id),
            filePath,
            relativePath: relPath,
          })
        }
      }
      return
    }

    if (node.type !== 'CallExpression') {
      // import.meta.glob handled below (CallExpression); decorators are
      // reached through their owning class/method nodes, but @Inject can
      // appear on constructor params too — catch every decorator node.
      if (node.type === 'Decorator') {
        const dc = decoratorCall(node)
        if (dc?.name === 'Inject') {
          const lit = stringValue((dc.call.arguments as Node[] | undefined)?.[0])
          if (lit !== null) injects.push({ name: lit, filePath, relativePath: relPath })
        }
      }
      return
    }

    const callee = node.callee as Node
    const name = calleeName(node)

    // Bare createToken('name') not consumed by the declarator pass
    if (name === 'createToken' && !seenTokenNodes.has(node)) {
      const tokenName = stringValue((node.arguments as Node[] | undefined)?.[0])
      if (tokenName !== null) {
        tokens.push({ name: tokenName, variable: null, filePath, relativePath: relPath })
      }
      return
    }

    // defineAdapter({ name }) / definePlugin({ name })
    if (name === 'defineAdapter' || name === 'definePlugin') {
      const literal = stringValue(getProp(firstObjectArg(node), 'name'))
      if (literal !== null) {
        const kind = name === 'definePlugin' ? 'plugin' : 'adapter'
        const dedupeKey = `${name}::${literal}::${filePath}`
        if (!seenHelperNames.has(dedupeKey)) {
          seenHelperNames.add(dedupeKey)
          pluginsAndAdapters.push({ kind, name: literal, filePath, relativePath: relPath })
        }
      }
      return
    }

    // defineAugmentation('Name', { description, example })
    if (name === 'defineAugmentation') {
      const args = (node.arguments as Node[] | undefined) ?? []
      const augName = stringValue(args[0])
      if (augName !== null) {
        const meta = isNode(args[1]) && args[1].type === 'ObjectExpression' ? args[1] : null
        augmentations.push({
          name: augName,
          description: stringValue(getProp(meta, 'description')),
          example: stringValue(getProp(meta, 'example')),
          filePath,
          relativePath: relPath,
        })
      }
      return
    }

    // defineContextDecorator({ key }) / defineHttpContextDecorator({ key })
    // — direct form
    if (name === 'defineContextDecorator' || name === 'defineHttpContextDecorator') {
      const key = stringValue(getProp(firstObjectArg(node), 'key'))
      if (key !== null && !seenContextKeys.has(key)) {
        seenContextKeys.add(key)
        contextKeys.push({ key, filePath, relativePath: relPath })
      }
      return
    }

    // Curried form: define(Http)ContextDecorator.withParams<P>()({ key })
    // — outer call's callee is the inner `withParams()` call.
    if (isNode(callee) && callee.type === 'CallExpression') {
      const innerCallee = callee.callee as Node
      if (
        isNode(innerCallee) &&
        innerCallee.type === 'MemberExpression' &&
        identifierName(innerCallee.property) === 'withParams'
      ) {
        const base = identifierName(innerCallee.object)
        if (base === 'defineContextDecorator' || base === 'defineHttpContextDecorator') {
          const key = stringValue(getProp(firstObjectArg(node), 'key'))
          if (key !== null && !seenContextKeys.has(key)) {
            seenContextKeys.add(key)
            contextKeys.push({ key, filePath, relativePath: relPath })
          }
        }
      }
      return
    }

    // import.meta.glob('...' | [...]) — module files only (caller gates)
    if (
      isNode(callee) &&
      callee.type === 'MemberExpression' &&
      identifierName(callee.property) === 'glob'
    ) {
      const obj = callee.object as Node
      if (isNode(obj) && obj.type === 'MetaProperty') {
        // Flatten every string literal across the args — matches the
        // regex behaviour (single string + array forms, options object
        // strings included only if literal; in practice options carry
        // booleans).
        walk(node.arguments, (argNode) => {
          const s = stringValue(argNode)
          if (s !== null) globPatterns.push(s)
        })
      }
    }
  })

  // ── Pass 3: class bodies — routes + class-style adapters ─────────────
  const allClasses: Array<{ cls: Node; className: string }> = []
  walk(program, (node) => {
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const className = identifierName(node.id)
      if (className) allClasses.push({ cls: node, className })
    }
  })

  for (const { cls, className } of allClasses) {
    const discovered = classes.find((c) => c.className === className)
    const body = (cls.body as Node | undefined)?.body as Node[] | undefined

    // Class-style adapters: `class X implements AppAdapter { name = '...' }`
    if (classImplements(cls, 'AppAdapter')) {
      for (const member of body ?? []) {
        if (member.type !== 'PropertyDefinition') continue
        if (identifierName(member.key) !== 'name') continue
        const literal = stringValue(member.value)
        if (literal === null) continue
        const dedupeKey = `class::${literal}::${filePath}`
        if (!seenHelperNames.has(dedupeKey)) {
          seenHelperNames.add(dedupeKey)
          pluginsAndAdapters.push({
            kind: 'adapter',
            name: literal,
            filePath,
            relativePath: relPath,
          })
        }
        break
      }
    }

    for (const member of body ?? []) {
      if (member.type !== 'MethodDefinition') continue
      const methodName = identifierName(member.key)
      if (!methodName) continue

      // Module mounts: `routes() { ... }` bodies — zip path/controller
      // pairs in source order (works for the class form; the object-
      // method form inside defineModule(build) is handled below).
      if (methodName === 'routes') {
        collectMounts(member.value as Node, moduleMounts)
        continue
      }

      // Route handlers — every HTTP decorator on the method emits one
      // route (stacked verbs = multiple routes, same as the regex).
      if (!discovered) continue
      const decs = decoratorsOf(member)
      const apiQp = extractApiQueryParams(decs, topLevelConstInits)
      for (const dec of decs) {
        const dc = decoratorCall(dec)
        if (!dc || !HTTP_DECORATORS.has(dc.name)) continue
        const args = (dc.call.arguments as Node[] | undefined) ?? []
        const rawPath = stringValue(args[0])
        const path = rawPath && rawPath.length > 0 ? rawPath : '/'
        const options = isNode(args[1]) && args[1].type === 'ObjectExpression' ? args[1] : null

        routes.push({
          controller: className,
          method: methodName,
          httpMethod: dc.name.toUpperCase() as DiscoveredRoute['httpMethod'],
          path,
          // extractFile contract: own-path params only — the cross-file
          // join re-applies mount prefixes (scanner.ts joinExtracts).
          pathParams: extractPathParams(path),
          queryFilterable: apiQp?.filterable ?? null,
          querySortable: apiQp?.sortable ?? null,
          querySearchable: apiQp?.searchable ?? null,
          bodySchema: schemaFieldRef(options, 'body', ctx),
          querySchema: schemaFieldRef(options, 'query', ctx),
          paramsSchema: schemaFieldRef(options, 'params', ctx),
          responseSchema: schemaFieldRef(options, 'response', ctx),
          filePath,
          relativePath: relPath,
          controllerIsDefaultExport: discovered.isDefault,
          // Per-file contract: own path only (parity with the regex
          // extractor's empty-mount default); joinExtracts overwrites with
          // the cross-file mount-joined path.
          mountedPath: path,
        })
      }
    }
  }

  // Object-method `routes()` (defineModule build objects and friends).
  walk(program, (node) => {
    if (node.type !== 'Property' || identifierName(node.key) !== 'routes') return
    const value = node.value as Node
    if (
      isNode(value) &&
      (value.type === 'FunctionExpression' || value.type === 'ArrowFunctionExpression')
    ) {
      collectMounts(value, moduleMounts)
    }
  })

  return {
    classes,
    tokens,
    injects,
    pluginsAndAdapters,
    augmentations,
    contextKeys,
    routes,
    moduleMounts,
    globPatterns: /\.module\.[mc]?[tj]sx?$/.test(filePath) ? globPatterns : [],
  }
}

/**
 * Collect `{ path: '...', controller: Ident }` pairs from a routes()
 * function body — zipped in traversal order, shorter list wins, same
 * as the regex `extractModuleMounts`.
 */
function collectMounts(fn: Node, out: ModuleMount[]): void {
  const paths: string[] = []
  const controllers: string[] = []
  walk(fn.body, (node) => {
    if (node.type !== 'Property') return
    const key = identifierName(node.key)
    if (key === 'path') {
      const s = stringValue(node.value)
      if (s !== null) paths.push(s)
    } else if (key === 'controller') {
      const id = identifierName(node.value)
      if (id && /^[A-Z]/.test(id)) controllers.push(id)
    }
  })
  const n = Math.min(paths.length, controllers.length)
  for (let i = 0; i < n; i++) {
    out.push({ controller: controllers[i], mountPath: paths[i] })
  }
}

/**
 * `joinExtracts` re-derives `pathParams` with the mount prefix — the
 * scanner needs the same joiner the regex path used; re-exported here
 * so both implementations share one definition is unnecessary (the
 * scanner keeps its own). This export exists for tests only.
 */
export const __testing = { joinMountPath, extractPathParams }
