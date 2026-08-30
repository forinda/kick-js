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
    if (this.isTuple(type)) return this.renderTuple(type, depth)
    const array = this.arrayElement(type)
    if (array) {
      const inner = this.render(array.element, depth + 1)
      // Parenthesise a union so `string | number[]` doesn't stand in for
      // `(string | number)[]`.
      const body = /[|&]/.test(inner) ? `(${inner})[]` : `${inner}[]`
      // `ReadonlyArray<T>` rendered as `T[]` hands the consumer a `push` the
      // route type forbids — permissive in the wrong direction.
      return array.readonly ? `readonly ${body}` : body
    }

    // A type the frontend already has — emit the name, expand nothing.
    if (this.isLibType(type)) return this.renderLibType(type, depth)

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
      // Depth RESETS here. The counter bounds how deeply types nest *inline*,
      // and a hoist ends that nesting: this body becomes its own top-level
      // `interface __Tn { … }` block, referenced by name from wherever it
      // appeared. Carrying the caller's depth in made a chain of named DTOs
      // spend the budget on nothing — a 15-link chain emitted
      // `interface __T12 { v: unknown }` where `v` was a plain `string`,
      // degrading real types over a nesting the output does not contain.
      this.blocks[index] = `interface ${name} {\n${this.members(type, 0, '  ')}\n}`
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
      const propType = this.typeOfProperty(prop)
      const optional = (prop.flags & this.ts.SymbolFlags.Optional) !== 0
      const rendered = this.renderPropertyType(propType, optional, prop, depth + 1)
      const readonly = this.isReadonlyProp(prop) ? 'readonly ' : ''
      lines.push(
        `${indent}${readonly}${this.propName(prop.getName())}${optional ? '?' : ''}: ${rendered}`,
      )
    }
    return lines.join(join === '\n' ? '\n' : join)
  }

  /**
   * The type of a property, declared or synthesized.
   *
   * `getTypeOfSymbol` is the only API that answers for both. A key-remapped
   * mapped type — `{ [K in keyof T as Camel<K>]: T[K] }` — produces properties
   * with NO declaration at all, and the previous code fell back to
   * `getDeclaredTypeOfSymbol` for those. That function answers for *type*
   * symbols (aliases, interfaces, classes); handed a property symbol it
   * returns the error type, so every remapped field emitted `any`:
   *
   *     { [K in keyof T as Camel<K>]: T[K] }  →  { contactName: any }
   *     { [K in keyof T]: T[K] }              →  { contact_name: string }
   *
   * The homomorphic form only ever worked by accident — its properties keep a
   * declaration pointing back at the source property.
   *
   * `any` is the worst possible degradation here: `unknown` forces a cast at
   * the call site, `any` silently type-checks against anything, so a route
   * that degraded this way was less safe than one still emitting `unknown`.
   */
  private typeOfProperty(prop: ts.Symbol): ts.Type {
    const checker = this.checker as ts.TypeChecker & {
      getTypeOfSymbol?: (symbol: ts.Symbol) => ts.Type
    }
    if (typeof checker.getTypeOfSymbol === 'function') return checker.getTypeOfSymbol(prop)
    // Older compiler APIs: the location-based call, which is correct for any
    // property that has a declaration to point at.
    const decl = prop.valueDeclaration ?? prop.declarations?.[0]
    return decl
      ? this.checker.getTypeOfSymbolAtLocation(prop, decl)
      : this.checker.getDeclaredTypeOfSymbol(prop)
  }

  /**
   * A property's type, with `undefined` dropped from an optional one — the
   * `?` already says that, and under `exactOptionalPropertyTypes` emitting
   * both is a difference the consumer feels.
   *
   * `null` must survive. `checker.getNonNullableType` strips both, which
   * turned `z.string().nullable().optional()` into `description?: string` —
   * a client that then rejects a `null` the server happily accepts. Silently
   * disagreeing with the ambient map is the one thing this generator must
   * never do.
   */
  private renderPropertyType(
    type: ts.Type,
    optional: boolean,
    prop: ts.Symbol,
    depth: number,
  ): string {
    if (!optional || !type.isUnion()) return this.render(type, depth)
    // `a?: string | undefined` and `a?: string` are the same type normally and
    // DIFFERENT under `exactOptionalPropertyTypes`, where only the first
    // accepts an explicit `{ a: undefined }`. The checker adds `undefined` to
    // every optional property, so the resolved type cannot tell them apart —
    // only the declaration can.
    if (this.declaresUndefined(prop)) return this.render(type, depth)
    const members = type.types.filter((m) => !(m.flags & this.ts.TypeFlags.Undefined))
    if (members.length === 0) return 'undefined'
    return members.map((m) => this.render(m, depth)).join(' | ')
  }

  /**
   * Whether the property's DECLARED type includes `undefined`.
   *
   * Resolved semantically rather than by reading the syntax: `a?: U` where
   * `type U = string | undefined` spells no `undefined` anywhere in the
   * declaration, yet accepts `{ a: undefined }` under
   * `exactOptionalPropertyTypes` exactly as the spelled-out form does.
   * Asking the checker for the declared node's type sees through the alias;
   * walking the union syntax does not.
   *
   * The declared type is the right question because the checker adds
   * `undefined` to every optional property's RESOLVED type, which is what
   * makes the two forms indistinguishable after resolution.
   */
  private isReadonlyProp(prop: ts.Symbol): boolean {
    const decl = prop.valueDeclaration ?? prop.declarations?.[0]
    if (!decl) return false
    return (this.ts.getCombinedModifierFlags(decl) & this.ts.ModifierFlags.Readonly) !== 0
  }

  private declaresUndefined(prop: ts.Symbol): boolean {
    const decl = prop.valueDeclaration ?? prop.declarations?.[0]
    if (!decl || !(this.ts.isPropertySignature(decl) || this.ts.isPropertyDeclaration(decl))) {
      return false
    }
    if (!decl.type) return false
    const declared = this.checker.getTypeFromTypeNode(decl.type)
    const members = declared.isUnion() ? declared.types : [declared]
    return members.some((m) => (m.flags & this.ts.TypeFlags.Undefined) !== 0)
  }

  /**
   * A tuple, with each element's flags honoured.
   *
   * `getTypeArguments` alone loses the shape entirely: `[string, number?]`
   * came out as `[string, undefined | number]` (one required element became
   * two), and `[string, ...number[]]` came out as `[string, number]` — a
   * variable-length tuple silently pinned to arity 2.
   */
  private renderTuple(type: ts.Type, depth: number): string {
    const E = this.ts.ElementFlags
    const args = this.checker.getTypeArguments(type as ts.TypeReference)
    const target = (type as ts.TypeReference).target as unknown as ts.TupleType
    const flags = target.elementFlags ?? []

    const parts = args.map((arg, i) => {
      const flag = flags[i] ?? E.Required
      if (flag & E.Optional) {
        // The `?` carries the undefined; leaving it in the type as well reads
        // as an explicitly-undefined element, which is a different thing.
        const inner = arg.isUnion()
          ? arg.types.filter((m) => !(m.flags & this.ts.TypeFlags.Undefined))
          : [arg]
        return `${inner.map((m) => this.render(m, depth + 1)).join(' | ')}?`
      }
      if (flag & E.Rest) return `...${this.render(arg, depth + 1)}[]`
      if (flag & E.Variadic) return `...${this.render(arg, depth + 1)}`
      return this.render(arg, depth + 1)
    })
    // `readonly [A, B]` losing its modifier is the tuple form of the same
    // over-permissiveness as ReadonlyArray.
    const prefix = target.readonly ? 'readonly ' : ''
    return `${prefix}[${parts.join(', ')}]`
  }

  /** Quote a property name that isn't a plain identifier. */
  private propName(name: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name)
  }

  /**
   * Declared in TypeScript's own lib files → the frontend already has it.
   *
   * A lib declaration covers the NAME, not the arguments: `Record` and `Map`
   * live in lib.es5, but `Record<string, SubjectCell>` names a project type
   * the client file has never heard of. So a lib alias is emitted by name and
   * its arguments are expanded — see `renderLibType`.
   */
  private isLibType(type: ts.Type): boolean {
    const decls = type.aliasSymbol?.declarations ?? type.getSymbol()?.declarations
    if (!decls || decls.length === 0) return false
    return decls.every((d) => this.program.isSourceFileDefaultLibrary(d.getSourceFile()))
  }

  /**
   * A lib type, with any type arguments expanded: `Record<string, __T4>`.
   *
   * Printing `typeToString` here instead is the bug this exists to prevent —
   * it emitted `Record<string, SubjectCell>` into a file with no `SubjectCell`,
   * and `tsc` on the frontend answered with `TS2304: Cannot find name`.
   */
  private renderLibType(type: ts.Type, depth: number): string {
    const name = (type.aliasSymbol ?? type.getSymbol())?.getName()
    const args = type.aliasTypeArguments ?? this.typeArguments(type)
    if (!name || args.length === 0) return this.checker.typeToString(type)
    return `${name}<${args.map((a) => this.render(a, depth + 1)).join(', ')}>`
  }

  /** Type arguments of a generic reference; empty for anything else. */
  private typeArguments(type: ts.Type): readonly ts.Type[] {
    if (!(type.flags & this.ts.TypeFlags.Object)) return []
    if (!((type as ts.ObjectType).objectFlags & this.ts.ObjectFlags.Reference)) return []
    return this.checker.getTypeArguments(type as ts.TypeReference)
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

  /** Element type and mutability if `type` is `T[]` / `ReadonlyArray<T>`. */
  private arrayElement(type: ts.Type): { element: ts.Type; readonly: boolean } | null {
    const symbolName = type.getSymbol()?.getName()
    if (symbolName !== 'Array' && symbolName !== 'ReadonlyArray') return null
    const args = this.checker.getTypeArguments(type as ts.TypeReference)
    if (args.length !== 1) return null
    return { element: args[0], readonly: symbolName === 'ReadonlyArray' }
  }
}
