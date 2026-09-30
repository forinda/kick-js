/**
 * Apply a layer's integrations to an EXISTING entry file — what `kick add`
 * does after installing a package that has a scaffold layer.
 *
 * `kick new` renders slots into a template it owns. An existing
 * `src/index.ts` is the user's file, so this never re-renders it: it finds
 * the `bootstrap({ ... })` call with oxc and splices text in — an entry at
 * the end of `adapters: [...]` (the array is created when missing), and the
 * import merged into an existing one from the same module or added after the
 * last import. Everything else in the file is left byte-for-byte alone.
 *
 * Idempotent: an entry whose call (`SwaggerAdapter(`) is already in the
 * array is skipped. When the file doesn't have the expected shape (no
 * `bootstrap({ ... })`, or `adapters` isn't an array literal), the entry is
 * returned as `manual` for the caller to print instead of guessing.
 */
import { parseSync } from 'oxc-parser'

import type { ImportSpec, Integration } from './overlay'

/** Which `bootstrap()` option each slot appends to. */
const SLOT_PROPERTY: Record<string, string> = {
  adapter: 'adapters',
  middleware: 'middlewares',
}

export interface WireResult {
  source: string
  /** Entries added, by the call they make (`SwaggerAdapter`). */
  added: string[]
  /** Entries already present. */
  present: string[]
  /** Entries that couldn't be placed — print them for the user. */
  manual: Integration[]
}

type Node = { type: string; start: number; end: number; [key: string]: any }

export function wireIntegrations(
  source: string,
  integrations: readonly Integration[],
  fill: (text: string) => string = (text) => text,
  file = 'src/index.ts',
): WireResult {
  const result: WireResult = { source, added: [], present: [], manual: [] }
  for (const integration of integrations) {
    if (!integration.slot || !integration.code) continue
    const property = SLOT_PROPERTY[integration.slot]
    const code = fill(integration.code)
    const call = callName(code)
    const program = parseSync(file, result.source).program as unknown as Node
    const options = property ? findBootstrapOptions(program) : undefined
    if (!options) {
      result.manual.push({ ...integration, code })
      continue
    }

    const prop = options.properties.find(
      (p: Node) => p.type === 'Property' && (p.key?.name ?? p.key?.value) === property,
    ) as Node | undefined
    if (prop && prop.value.type !== 'ArrayExpression') {
      result.manual.push({ ...integration, code })
      continue
    }
    // Under the name this file calls it: `import { SwaggerAdapter as SA }` → `SA(`.
    const local =
      call && integration.import ? localName(program, integration.import.from, call) : call
    if (
      prop &&
      local &&
      result.source.slice(prop.value.start, prop.value.end).includes(`${local}(`)
    ) {
      result.present.push(call ?? firstLine(code))
      continue
    }

    result.source = prop
      ? appendToArray(result.source, prop.value, code)
      : addProperty(result.source, options, property!, code)
    if (integration.import) result.source = addImport(result.source, integration.import, file)
    result.added.push(call ?? firstLine(code))
  }
  return result
}

/** The object literal passed to the first `bootstrap(...)` call. */
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

/** The local binding of `imported` from `from`, when this file imports it (possibly renamed). */
function localName(program: Node, from: string, imported: string): string {
  for (const node of program.body as Node[]) {
    if (node.type !== 'ImportDeclaration' || node.source.value !== from) continue
    for (const specifier of node.specifiers as Node[]) {
      const name = specifier.imported?.name ?? specifier.imported?.value
      if (specifier.type === 'ImportSpecifier' && name === imported) return specifier.local.name
    }
  }
  return imported
}

/** `SwaggerAdapter` for `// comment\nSwaggerAdapter({ ... })`. */
function callName(code: string): string | undefined {
  const line = code.split('\n').find((l) => l.trim() && !l.trim().startsWith('//'))
  return /^\s*([A-Za-z_$][\w$.]*)\s*\(/.exec(line ?? '')?.[1]
}

const firstLine = (code: string) =>
  code
    .split('\n')
    .find((l) => l.trim() && !l.trim().startsWith('//'))
    ?.trim() ?? code

const lineIndent = (source: string, offset: number) =>
  /^[ \t]*/.exec(source.slice(source.lastIndexOf('\n', offset - 1) + 1))![0]

const indentBlock = (code: string, indent: string) =>
  code
    .split('\n')
    .map((line) => (line ? indent + line : line))
    .join('\n')

function appendToArray(source: string, array: Node, code: string): string {
  const elements = (array.elements as Array<Node | null>).filter(Boolean) as Node[]
  const arrayIndent = lineIndent(source, array.start)
  if (elements.length === 0) {
    const inner = indentBlock(`${code},`, `${arrayIndent}  `)
    return `${source.slice(0, array.start)}[\n${inner}\n${arrayIndent}]${source.slice(array.end)}`
  }
  const last = elements.at(-1)!
  const indent = lineIndent(source, last.start)
  // After the last element's trailing comma when it has one.
  const after = source.slice(last.end, array.end - 1)
  const comma = after.match(/^\s*,/)
  const at = comma ? last.end + comma[0].length : last.end
  const entry = `\n${indentBlock(`${code},`, indent)}`
  return comma
    ? source.slice(0, at) + entry + source.slice(at)
    : `${source.slice(0, at)},${entry.replace(/,$/, '')}${source.slice(at)}`
}

function addProperty(source: string, object: Node, property: string, code: string): string {
  const props = object.properties as Node[]
  const last = props.at(-1)
  const indent = last ? lineIndent(source, last.start) : `${lineIndent(source, object.start)}  `
  const block = `${indent}${property}: [\n${indentBlock(`${code},`, `${indent}  `)}\n${indent}],`
  if (!last) {
    return `${source.slice(0, object.start)}{\n${block}\n${lineIndent(source, object.start)}}${source.slice(object.end)}`
  }
  const after = source.slice(last.end, object.end - 1)
  const comma = after.match(/^\s*,/)
  const at = comma ? last.end + comma[0].length : last.end
  // A one-line `bootstrap({ modules })` becomes multi-line; the project's
  // formatter tidies the rest.
  return `${source.slice(0, at)}${comma ? '' : ','}\n${block}${source.slice(at)}`
}

/** Add `spec`'s names to an import from the same module, or a new import after the last one. */
export function addImport(source: string, spec: ImportSpec, file = 'src/index.ts'): string {
  const program = parseSync(file, source).program as unknown as Node
  const imports = (program.body as Node[]).filter((n) => n.type === 'ImportDeclaration')
  const existing = imports.find(
    (n) =>
      n.source.value === spec.from &&
      n.importKind !== 'type' &&
      // A side-effect `import 'x'` has nothing to merge into.
      n.specifiers.length > 0 &&
      !n.specifiers.some((s: Node) => s.type === 'ImportNamespaceSpecifier'),
  )
  const names = spec.names ?? []

  if (existing) {
    const have = new Set(existing.specifiers.map((s: Node) => s.local?.name))
    const missing = names.filter((name) => !have.has(name))
    if (missing.length === 0) return source
    const named = existing.specifiers.filter((s: Node) => s.type === 'ImportSpecifier')
    if (named.length > 0) {
      const at = named.at(-1).end
      return `${source.slice(0, at)}, ${missing.join(', ')}${source.slice(at)}`
    }
    // Only a default import: `import d from 'x'` → `import d, { a } from 'x'`.
    const def = existing.specifiers[0]
    return `${source.slice(0, def.end)}, { ${missing.join(', ')} }${source.slice(def.end)}`
  }

  const parts = [spec.default, names.length ? `{ ${names.join(', ')} }` : undefined].filter(Boolean)
  const line = `import ${parts.join(', ')} from '${spec.from}'`
  const last = imports.at(-1)
  if (!last) return `${line}\n${source}`
  return `${source.slice(0, last.end)}\n${line}${source.slice(last.end)}`
}
