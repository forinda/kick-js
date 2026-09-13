/**
 * `kick check --di` — REQUEST-scoped dependencies injected through the
 * constructor of a SINGLETON (#676).
 *
 * The container rejects that pairing, but only when it first resolves the
 * parent — on the first request that reaches the route, as a 500. Both scopes
 * are written in the source, so the mismatch is decidable before anything runs.
 *
 * Deliberately conservative: a finding needs the parent's scope and the
 * dependency's scope both pinned down as literals. Anything the scan cannot
 * resolve — a scope held in a variable, a name declared in more than one file,
 * a token registered under two scopes — produces no finding. A clean run is not
 * proof; a finding is a request that will fail.
 *
 * @module @forinda/kickjs-cli/commands/check-di
 */
import { parseSync } from 'oxc-parser'

import {
  decoratorCall,
  decoratorsOf,
  firstObjectArg,
  getProp,
  identifierName,
  isNode,
  stringValue,
  walk,
  type AstNode as Node,
} from '../typegen/extract-ast'

export interface SourceFile {
  /** Path shown in findings (relative to the project root). */
  path: string
  source: string
}

export interface ScopeMismatch {
  file: string
  line: number
  parent: string
  dependency: string
  message: string
}

type ScopeValue = 'singleton' | 'transient' | 'request' | 'unknown'

/** Decorators that register a class and accept `{ scope }`. `@Controller()` takes no options. */
const SCOPED_DECORATORS = new Set(['Service', 'Injectable', 'Component', 'Repository'])

interface ClassInfo {
  name: string
  kind: 'controller' | 'other'
  file: string
  params: Array<{ key: string; label: string; line: number }>
}

function lineOf(source: string, offset: unknown): number {
  return typeof offset === 'number' ? source.slice(0, offset).split('\n').length : 1
}

/** `Scope.REQUEST` or `'request'`; anything else is unknown, never guessed. */
function scopeOf(node: unknown): ScopeValue {
  const literal = stringValue(node)
  if (literal === 'singleton' || literal === 'transient' || literal === 'request') return literal
  if (isNode(node) && node.type === 'MemberExpression' && identifierName(node.object) === 'Scope') {
    const member = identifierName(node.property)
    if (member === 'SINGLETON') return 'singleton'
    if (member === 'TRANSIENT') return 'transient'
    if (member === 'REQUEST') return 'request'
  }
  return 'unknown'
}

/** DI key for a token expression: an identifier or a string literal. */
function tokenKey(node: unknown): { key: string; label: string } | null {
  const id = identifierName(node)
  if (id) return { key: `id:${id}`, label: id }
  const literal = stringValue(node)
  if (literal !== null) return { key: `lit:${literal}`, label: `'${literal}'` }
  return null
}

function constructorParams(cls: Node, source: string): ClassInfo['params'] {
  const members = ((cls.body as Node | undefined)?.body as Node[] | undefined) ?? []
  const ctor = members.find((m) => m.type === 'MethodDefinition' && m.kind === 'constructor')
  const params = ((ctor?.value as Node | undefined)?.params as Node[] | undefined) ?? []
  const out: ClassInfo['params'] = []
  for (const param of params) {
    const inner = param.type === 'TSParameterProperty' ? (param.parameter as Node) : param
    const inject = decoratorsOf(param)
      .map(decoratorCall)
      .find((d) => d?.name === 'Inject')
    let token: { key: string; label: string } | null = null
    if (inject) {
      token = tokenKey((inject.call.arguments as Node[] | undefined)?.[0])
    } else {
      // No @Inject: the container resolves by the parameter's class type.
      const type = ((inner?.typeAnnotation as Node | undefined)?.typeAnnotation ??
        null) as Node | null
      if (type?.type === 'TSTypeReference') token = tokenKey(type.typeName)
    }
    if (token) out.push({ ...token, line: lineOf(source, param.start) })
  }
  return out
}

export function findScopeMismatches(files: SourceFile[]): ScopeMismatch[] {
  /** DI key → every scope it is registered under. */
  const scopes = new Map<string, Set<ScopeValue>>()
  /** Top-level name → files declaring it; a name in two files cannot be resolved. */
  const declaredIn = new Map<string, Set<string>>()
  const classes: ClassInfo[] = []

  const addScope = (key: string, scope: ScopeValue) => {
    if (!scopes.has(key)) scopes.set(key, new Set())
    scopes.get(key)!.add(scope)
  }
  const declare = (name: string | null, file: string) => {
    if (!name) return
    if (!declaredIn.has(name)) declaredIn.set(name, new Set())
    declaredIn.get(name)!.add(file)
  }

  for (const { path, source } of files) {
    let program: Node
    try {
      const result = parseSync(path, source)
      if (result.errors.length > 0) continue
      program = result.program as unknown as Node
    } catch {
      continue
    }

    for (const stmt of (program.body as Node[] | undefined) ?? []) {
      const decl =
        (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') &&
        isNode(stmt.declaration)
          ? (stmt.declaration as Node)
          : stmt
      if (decl.type === 'ClassDeclaration') declare(identifierName(decl.id), path)
      if (decl.type === 'VariableDeclaration') {
        for (const d of (decl.declarations as Node[] | undefined) ?? []) {
          declare(identifierName(d.id), path)
        }
      }
    }

    walk(program, (node) => {
      if (node.type === 'ClassDeclaration') {
        const name = identifierName(node.id)
        if (!name) return
        for (const dec of decoratorsOf(node)) {
          const call = decoratorCall(dec)
          if (!call) continue
          if (call.name === 'Controller') {
            addScope(`id:${name}`, 'singleton')
            classes.push({
              name,
              kind: 'controller',
              file: path,
              params: constructorParams(node, source),
            })
            return
          }
          if (SCOPED_DECORATORS.has(call.name)) {
            const scopeArg = getProp(firstObjectArg(call.call), 'scope')
            const scope = scopeArg ? scopeOf(scopeArg) : 'singleton'
            addScope(`id:${name}`, scope)
            classes.push({
              name,
              kind: 'other',
              file: path,
              params: constructorParams(node, source),
            })
            return
          }
        }
        return
      }

      // container.register(token, Target, scope?) / registerFactory(token, factory, scope?)
      if (node.type !== 'CallExpression') return
      const callee = node.callee as Node
      if (!isNode(callee) || callee.type !== 'MemberExpression') return
      const method = identifierName(callee.property)
      if (method !== 'register' && method !== 'registerFactory') return
      const args = (node.arguments as Node[] | undefined) ?? []
      if (args.length < 2) return
      const token = tokenKey(args[0])
      if (!token) return
      addScope(token.key, args.length >= 3 ? scopeOf(args[2]) : 'singleton')
    })
  }

  const resolvable = (label: string) => (declaredIn.get(label)?.size ?? 0) <= 1
  const only = (key: string, scope: ScopeValue) => {
    const set = scopes.get(key)
    return set?.size === 1 && set.has(scope)
  }

  const findings: ScopeMismatch[] = []
  for (const cls of classes) {
    if (!resolvable(cls.name) || !only(`id:${cls.name}`, 'singleton')) continue
    for (const param of cls.params) {
      if (param.key.startsWith('id:') && !resolvable(param.label)) continue
      if (!only(param.key, 'request')) continue
      const fix =
        cls.kind === 'controller'
          ? `@Controller() is always SINGLETON, so inject ${param.label} with @Autowired() instead of the constructor.`
          : `Give ${cls.name} TRANSIENT or REQUEST scope, or inject ${param.label} with @Autowired() instead of the constructor.`
      findings.push({
        file: cls.file,
        line: param.line,
        parent: cls.name,
        dependency: param.label,
        message: `${cls.name} (SINGLETON) injects REQUEST-scoped ${param.label} through its constructor — the first request that resolves it answers 500. ${fix}`,
      })
    }
  }
  return findings
}
