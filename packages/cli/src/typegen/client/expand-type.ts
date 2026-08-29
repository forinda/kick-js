/**
 * `ts.Type` → source text that compiles in a file with **no imports**.
 *
 * `checker.typeToString()` cannot do this: it prints named types by name, and
 * those names live in the server's program. The client route map exists
 * precisely so the frontend does not compile the server, so every name has to
 * be either expanded into structure or proven to exist in the frontend already.
 *
 * Three rules carry the whole design:
 *
 * 1. **Lib types stay named.** `Date`, `Map`, `Promise`, `RegExp` are declared
 *    in TypeScript's own lib files, which every frontend has. Expanding them
 *    would be enormous and wrong.
 * 2. **Named project types hoist.** 1,940 routes over ~300 DTOs means naive
 *    inlining multiplies the same shapes hundreds of times. Each named shape
 *    becomes one `interface __T<n>` and is referenced by name.
 * 3. **Hoisting is also cycle termination.** `Student.school.students` is
 *    infinite to inline; a type already being expanded already has a name.
 *
 * @module @forinda/kickjs-cli/typegen/client/expand-type
 */
import type ts from '@typescript/typescript6'

import type { TsApi } from './ts-compiler'

export interface TypeExpanderOptions {
  /** Depth beyond which a type degrades to `unknown`. Default 12. */
  maxDepth?: number
  onWarn?: (msg: string) => void
}

export class TypeExpander {
  private readonly hoistedByType = new Map<ts.Type, string>()
  private readonly blocks: string[] = []
  private readonly maxDepth: number

  constructor(
    private readonly ts: TsApi,
    private readonly checker: ts.TypeChecker,
    private readonly program: ts.Program,
    private readonly opts: TypeExpanderOptions = {},
  ) {
    this.maxDepth = opts.maxDepth ?? 12
  }

  /** Hoisted `interface __T<n> { … }` blocks, in creation order. */
  hoisted(): string[] {
    return this.blocks
  }

  expand(type: ts.Type): string {
    return this.render(type, 0)
  }

  private render(type: ts.Type, depth: number): string {
    const F = this.ts.TypeFlags

    if (depth > this.maxDepth) {
      this.opts.onWarn?.(
        `type nesting exceeded ${this.maxDepth} levels — emitting 'unknown'. ` +
          `Declare a response schema on the route for an exact type.`,
      )
      return 'unknown'
    }

    // Primitives and keywords — typeToString is exactly right for these and
    // carries no names from the program.
    if (type.flags & (F.String | F.Number | F.Boolean | F.BigInt | F.ESSymbol)) {
      return this.checker.typeToString(type)
    }
    if (type.flags & (F.Any | F.Unknown | F.Never | F.Void | F.Undefined | F.Null)) {
      return this.checker.typeToString(type)
    }
    if (type.isLiteral() || type.flags & F.BooleanLiteral) {
      return this.checker.typeToString(type)
    }

    if (type.isUnion()) {
      return type.types.map((m) => this.render(m, depth + 1)).join(' | ')
    }
    if (type.isIntersection()) {
      return type.types.map((m) => this.render(m, depth + 1)).join(' & ')
    }

    // Tuples before arrays — a tuple is also a reference to an array type.
    if (this.isTuple(type)) {
      const args = this.checker.getTypeArguments(type as ts.TypeReference)
      return `[${args.map((a) => this.render(a, depth + 1)).join(', ')}]`
    }
    const element = this.arrayElement(type)
    if (element) {
      const inner = this.render(element, depth + 1)
      // Parenthesise a union so `string | number[]` doesn't stand in for
      // `(string | number)[]`.
      return /[|&]/.test(inner) ? `(${inner})[]` : `${inner}[]`
    }

    // A type the frontend already has — emit the name, expand nothing.
    if (this.isLibType(type)) return this.checker.typeToString(type)

    if (type.flags & F.Object) return this.renderObject(type, depth)

    // Type parameters, conditionals that didn't resolve, anything unmodelled.
    this.opts.onWarn?.(
      `could not expand type '${this.checker.typeToString(type)}' — emitting 'unknown'`,
    )
    return 'unknown'
  }

  private renderObject(type: ts.Type, depth: number): string {
    const existing = this.hoistedByType.get(type)
    if (existing) return existing

    if (this.isNamed(type)) {
      // Reserve the name BEFORE expanding the body: a self-referencing type
      // must find its own name already in the map.
      const name = `__T${this.hoistedByType.size}`
      this.hoistedByType.set(type, name)
      const index = this.blocks.length
      this.blocks.push('') // hold the slot so ordering matches creation order
      this.blocks[index] = `interface ${name} {\n${this.members(type, depth, '  ')}\n}`
      return name
    }

    const inline = this.members(type, depth, '', '; ')
    return inline.length > 0 ? `{ ${inline} }` : '{}'
  }

  private members(type: ts.Type, depth: number, indent: string, join = '\n'): string {
    const lines: string[] = []

    for (const info of this.checker.getIndexInfosOfType(type)) {
      const key = this.checker.typeToString(info.keyType)
      lines.push(`${indent}[key: ${key}]: ${this.render(info.type, depth + 1)}`)
    }

    for (const prop of this.checker.getPropertiesOfType(type)) {
      const decl = prop.valueDeclaration ?? prop.declarations?.[0]
      const propType = decl
        ? this.checker.getTypeOfSymbolAtLocation(prop, decl)
        : this.checker.getDeclaredTypeOfSymbol(prop)
      const optional = (prop.flags & this.ts.SymbolFlags.Optional) !== 0
      // An optional property's type already includes `undefined`; emitting
      // both is noise, and under `exactOptionalPropertyTypes` it is a
      // difference the consumer feels.
      const rendered = this.render(
        optional ? this.checker.getNonNullableType(propType) : propType,
        depth + 1,
      )
      lines.push(`${indent}${this.propName(prop.getName())}${optional ? '?' : ''}: ${rendered}`)
    }
    return lines.join(join === '\n' ? '\n' : join)
  }

  /** Quote a property name that isn't a plain identifier. */
  private propName(name: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name)
  }

  /** Declared in TypeScript's own lib files → the frontend already has it. */
  private isLibType(type: ts.Type): boolean {
    const decls = type.getSymbol()?.declarations
    if (!decls || decls.length === 0) return false
    return decls.every((d) => this.program.isSourceFileDefaultLibrary(d.getSourceFile()))
  }

  /** Has a declared name worth hoisting (interface / class / named alias). */
  private isNamed(type: ts.Type): boolean {
    const symbol = type.getSymbol()
    if (!symbol) return false
    const name = symbol.getName()
    return name !== '__type' && name !== '__object' && name.length > 0
  }

  private isTuple(type: ts.Type): boolean {
    const objectFlags = this.ts.ObjectFlags
    if (!(type.flags & this.ts.TypeFlags.Object)) return false
    if (!((type as ts.ObjectType).objectFlags & objectFlags.Reference)) return false
    const target = (type as ts.TypeReference).target as ts.ObjectType | undefined
    return Boolean(target && target.objectFlags & objectFlags.Tuple)
  }

  /** Element type if `type` is `T[]` / `ReadonlyArray<T>`, else null. */
  private arrayElement(type: ts.Type): ts.Type | null {
    const symbolName = type.getSymbol()?.getName()
    if (symbolName !== 'Array' && symbolName !== 'ReadonlyArray') return null
    const args = this.checker.getTypeArguments(type as ts.TypeReference)
    return args.length === 1 ? args[0] : null
  }
}
