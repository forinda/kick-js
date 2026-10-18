/**
 * Move an existing app to another HTTP engine — what `kick runtime <engine>`
 * does to its files. Like `wire.ts`, it finds the `bootstrap({ ... })` call with
 * oxc and splices text; everything else in the file is left as it was.
 *
 * In the entry file: the `runtime:` option calls the new engine's factory, the
 * old factory's import goes and the new one's comes in, and Express's
 * `express.json()` body parser leaves `middlewares` (or joins it), since
 * Fastify and h3 parse bodies themselves. In kick.config.ts: `runtime: '<engine>'`.
 */
import { parseSync } from 'oxc-parser'

import type { AppRuntime } from '../commands/add'
import { addImport, wireIntegrations } from './wire'

type Node = { type: string; start: number; end: number; [key: string]: any }

/** Each engine's runtime factory and where it's imported from. */
export const RUNTIME_FACTORIES: Record<AppRuntime, { name: string; from: string }> = {
  express: { name: 'expressRuntime', from: '@forinda/kickjs' },
  fastify: { name: 'fastifyRuntime', from: '@forinda/kickjs/fastify' },
  h3: { name: 'h3Runtime', from: '@forinda/kickjs/h3' },
}

export interface RuntimeSwapResult {
  source: string
  /** What changed, for the summary. */
  changes: string[]
  /** What it couldn't do — print for the user. */
  manual: string[]
  /**
   * The `runtime:` option isn't a call to the old engine's factory (a variable,
   * a condition, shorthand): nothing was changed, and the move should stop.
   */
  blocked: boolean
}

/** The comment `kick new` writes above `express.json()`. */
const BODY_PARSER_COMMENT = '// Express needs a body parser; Fastify and h3 parse bodies natively.'

export function swapRuntime(
  source: string,
  from: AppRuntime,
  to: AppRuntime,
  file = 'src/index.ts',
): RuntimeSwapResult {
  const result: RuntimeSwapResult = { source, changes: [], manual: [], blocked: false }
  const oldFactory = RUNTIME_FACTORIES[from]
  const newFactory = RUNTIME_FACTORIES[to]

  // 1. `runtime: oldRuntime(...)` → `runtime: newRuntime()`.
  const options = findBootstrapOptions(parse(file, result.source))
  if (!options) {
    result.manual.push(
      `No bootstrap({ ... }) call in ${file}: set \`runtime: ${newFactory.name}()\` ` +
        `(import { ${newFactory.name} } from '${newFactory.from}') yourself.`,
    )
    return result
  }
  const runtime = property(options, 'runtime')
  const call = `${newFactory.name}()`
  if (runtime) {
    const value = runtime.value as Node
    // Only a direct call to the old factory, under whatever name this file imports it.
    const oldLocal = importedAs(parse(file, result.source), oldFactory.from, oldFactory.name)
    if (
      runtime.shorthand ||
      value.type !== 'CallExpression' ||
      value.callee?.type !== 'Identifier' ||
      oldLocal === undefined ||
      value.callee.name !== oldLocal
    ) {
      const text = result.source.slice(runtime.start, runtime.end)
      result.manual.push(
        `\`${text}\` in ${file} isn't a call to ${oldFactory.name}(): set it to ${call} ` +
          `(import { ${newFactory.name} } from '${newFactory.from}') yourself.`,
      )
      result.blocked = true
      return result
    }
    const args = value.arguments as Node[]
    if (args.length > 0) {
      const text = result.source.slice(args[0]!.start, args.at(-1)!.end)
      result.manual.push(
        `The ${from} runtime had options (${text}); ${to} takes its own — see guide/http-runtimes.`,
      )
    }
    result.source = result.source.slice(0, value.start) + call + result.source.slice(value.end)
  } else {
    result.source = insertProperty(result.source, options, `runtime: ${call}`)
  }
  result.changes.push(`runtime: ${call}`)

  // 2. Imports: the new factory in, the old one out once nothing calls it.
  result.source = addImport(
    result.source,
    { from: newFactory.from, names: [newFactory.name] },
    file,
  )
  result.source = removeImportIfUnused(result.source, oldFactory.from, oldFactory.name, file)

  // 3. Express's body parser: out when leaving Express, in when arriving.
  if (from === 'express' && to !== 'express') {
    const removed = removeExpressJson(result.source, file)
    if (removed !== result.source) {
      result.source = removeDefaultImportIfUnused(removed, 'express', file)
      result.changes.push(`removed express.json() — ${to} parses bodies itself`)
    }
  } else if (to === 'express' && from !== 'express') {
    const wired = wireIntegrations(
      result.source,
      [
        {
          import: { from: 'express', default: 'express' },
          slot: 'middleware',
          code: `${BODY_PARSER_COMMENT}\nexpress.json()`,
        },
      ],
      undefined,
      file,
    )
    result.source = wired.source
    if (wired.added.length > 0) result.changes.push('added express.json() to middlewares')
    if (wired.manual.length > 0) {
      result.manual.push('Add express.json() to bootstrap({ middlewares }) yourself.')
    }
  }
  return result
}

/**
 * kick.config.ts's `runtime`, set to `to` — the property of the exported config
 * object (`export default defineConfig({ ... })` or `export default { ... }`),
 * added when it has none. Null when there is no such object to edit.
 */
export function swapConfigRuntime(
  source: string,
  to: AppRuntime,
  file = 'kick.config.ts',
): string | null {
  const program = parse(file, source)
  const exported = (program.body as Node[]).find((n) => n.type === 'ExportDefaultDeclaration')
  let object = exported?.declaration as Node | undefined
  while (object && (object.type === 'TSSatisfiesExpression' || object.type === 'TSAsExpression')) {
    object = object.expression
  }
  if (object?.type === 'CallExpression') object = object.arguments?.[0]
  if (object?.type !== 'ObjectExpression') return null
  const runtime = property(object, 'runtime')
  if (!runtime) return insertProperty(source, object, `runtime: '${to}'`)
  const value = runtime.value as Node
  if (value.type !== 'Literal' || typeof value.value !== 'string') return null
  const quote = source[value.start] === '"' ? '"' : "'"
  return `${source.slice(0, value.start)}${quote}${to}${quote}${source.slice(value.end)}`
}

function parse(file: string, source: string): Node {
  return parseSync(file, source).program as unknown as Node
}

function findBootstrapOptions(program: Node): Node | undefined {
  let found: Node | undefined
  const visit = (node: unknown): void => {
    if (found || !node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(visit)
    const n = node as Node
    if (
      n.type === 'CallExpression' &&
      n.callee?.type === 'Identifier' &&
      n.callee.name === 'bootstrap' &&
      n.arguments?.[0]?.type === 'ObjectExpression'
    ) {
      found = n.arguments[0]
      return
    }
    for (const key in n) visit(n[key])
  }
  visit(program)
  return found
}

function property(object: Node, name: string): Node | undefined {
  return (object.properties as Node[]).find(
    (p) => p.type === 'Property' && (p.key?.name ?? p.key?.value) === name,
  )
}

/** Add `text` (`key: value`) as the object's first property. */
function insertProperty(source: string, object: Node, text: string): string {
  const first = (object.properties as Node[])[0]
  if (!first) return `${source.slice(0, object.start)}{ ${text} }${source.slice(object.end)}`
  const lineStart = source.lastIndexOf('\n', first.start) + 1
  const indent = source.slice(lineStart, first.start)
  const sameLine = !/^\s*$/.test(indent)
  return sameLine
    ? `${source.slice(0, first.start)}${text}, ${source.slice(first.start)}`
    : `${source.slice(0, first.start)}${text},\n${indent}${source.slice(first.start)}`
}

/** Remove `express.json(...)` from `bootstrap({ middlewares: [...] })`, with its comma and comment. */
function removeExpressJson(source: string, file: string): string {
  const options = findBootstrapOptions(parse(file, source))
  const list = options && property(options, 'middlewares')
  if (!list || list.value.type !== 'ArrayExpression') return source
  const element = (list.value.elements as Array<Node | null>).find(
    (e) =>
      e?.type === 'CallExpression' &&
      e.callee?.type === 'MemberExpression' &&
      e.callee.object?.name === 'express' &&
      e.callee.property?.name === 'json',
  )
  if (!element) return source
  let start = element.start
  let end = element.end
  // The comma after it, and the whole line when it sits alone on one.
  const comma = source.slice(end).match(/^\s*,/)
  if (comma) end += comma[0].length
  const lineStart = source.lastIndexOf('\n', start) + 1
  if (/^\s*$/.test(source.slice(lineStart, start))) {
    start = lineStart
    // The comment kick new writes above it goes too — no other comment.
    const above = source.lastIndexOf('\n', start - 2) + 1
    if (source.slice(above, start - 1).trim() === BODY_PARSER_COMMENT) start = above
    const lineEnd = source.indexOf('\n', end)
    if (lineEnd !== -1 && /^\s*$/.test(source.slice(end, lineEnd))) end = lineEnd + 1
  }
  return source.slice(0, start) + source.slice(end)
}

/**
 * The local name this file imports `name` from `from` under; undefined when it
 * doesn't import it from there — a same-named function from elsewhere isn't it.
 */
function importedAs(program: Node, from: string, name: string): string | undefined {
  for (const node of program.body as Node[]) {
    if (node.type !== 'ImportDeclaration' || node.source.value !== from) continue
    for (const specifier of node.specifiers as Node[]) {
      const imported = specifier.imported?.name ?? specifier.imported?.value
      if (specifier.type === 'ImportSpecifier' && imported === name) return specifier.local.name
    }
  }
  return undefined
}

/** Drop `name` from `import { … } from 'from'` when the file no longer uses it. */
function removeImportIfUnused(source: string, from: string, name: string, file: string): string {
  const program = parse(file, source)
  for (const node of program.body as Node[]) {
    if (node.type !== 'ImportDeclaration' || node.source.value !== from) continue
    const specifier = (node.specifiers as Node[]).find(
      (s) => s.type === 'ImportSpecifier' && (s.imported?.name ?? s.imported?.value) === name,
    )
    if (!specifier) continue
    if (usedOutsideImports(program, specifier.local.name)) return source
    return removeSpecifier(source, node, specifier)
  }
  return source
}

/** Drop `import <local> from 'from'` when the file no longer uses `<local>`. */
function removeDefaultImportIfUnused(source: string, from: string, file: string): string {
  const program = parse(file, source)
  for (const node of program.body as Node[]) {
    if (node.type !== 'ImportDeclaration' || node.source.value !== from) continue
    const specifier = (node.specifiers as Node[]).find((s) => s.type === 'ImportDefaultSpecifier')
    if (!specifier) continue
    if (usedOutsideImports(program, specifier.local.name)) return source
    return removeSpecifier(source, node, specifier)
  }
  return source
}

/** Whether code outside the imports refers to `local` — identifiers only, never strings or comments. */
function usedOutsideImports(program: Node, local: string): boolean {
  let used = false
  const visit = (node: unknown): void => {
    if (used || !node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(visit)
    const n = node as Node
    if (n.type === 'ImportDeclaration') return
    if ((n.type === 'Identifier' || n.type === 'IdentifierReference') && n.name === local) {
      used = true
      return
    }
    for (const key in n) if (key !== 'parent') visit(n[key])
  }
  visit(program.body)
  return used
}

function removeSpecifier(source: string, declaration: Node, specifier: Node): string {
  const specifiers = declaration.specifiers as Node[]
  if (specifiers.length === 1) {
    // The whole declaration, with its line break.
    const end = source[declaration.end] === '\n' ? declaration.end + 1 : declaration.end
    return source.slice(0, declaration.start) + source.slice(end)
  }
  const named = specifiers.filter((s) => s.type === 'ImportSpecifier')
  if (specifier.type === 'ImportSpecifier' && named.length === 1) {
    // `import d, { x } from 'm'` → `import d from 'm'`.
    const open = source.lastIndexOf(',', specifier.start)
    const close = source.indexOf('}', specifier.end) + 1
    return source.slice(0, open) + source.slice(close)
  }
  if (specifier.type === 'ImportDefaultSpecifier') {
    // `import d, { x } from 'm'` → `import { x } from 'm'`.
    const next = source.indexOf(',', specifier.end) + 1
    const after = source.slice(next).match(/^\s*/)![0].length
    return source.slice(0, specifier.start) + source.slice(next + after)
  }
  // One of several named imports: it and the comma that separates it.
  const index = named.indexOf(specifier)
  const start = index === 0 ? specifier.start : named[index - 1]!.end
  const end = index === 0 ? named[1]!.start : specifier.end
  return source.slice(0, start) + source.slice(end)
}
