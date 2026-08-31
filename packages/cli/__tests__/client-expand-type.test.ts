/**
 * The expander turns a resolved `ts.Type` into text that compiles in a file
 * with NO imports. That is the whole point of the client route map (#543), so
 * every case here is about a way a type can secretly depend on the server's
 * program.
 *
 * The compiler API comes from `@typescript/typescript6`, not `typescript` —
 * this repo runs TypeScript 7, whose package ships a binary and no API at all.
 *
 * @module @forinda/kickjs-cli/__tests__/client-expand-type.test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from '@typescript/typescript6'

import { TypeExpander } from '../src/typegen/client/expand-type'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kick-expand-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/**
 * Compile a one-file program and expand the type of `type Target = …`.
 * A real file on disk beats a hand-rolled in-memory CompilerHost: the lib
 * files resolve the way they do in a real project, which is exactly what the
 * `isSourceFileDefaultLibrary` check depends on.
 */
function expand(
  source: string,
  opts: {
    maxDepth?: number
    compilerOptions?: ts.CompilerOptions
    onWarn?: (msg: string) => void
  } = {},
) {
  const file = join(dir, `case-${Math.random().toString(36).slice(2)}.ts`)
  writeFileSync(file, source)

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
    ...opts.compilerOptions,
  }
  const program = ts.createProgram({ rootNames: [file], options })
  const checker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(file)!
  const alias = sourceFile.statements.find(
    (s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === 'Target',
  )!

  const expander = new TypeExpander(ts, checker, program, opts)
  return {
    text: expander.expand(checker.getTypeAtLocation(alias.type)),
    hoisted: expander.hoisted(),
  }
}

describe('TypeExpander', () => {
  it('passes primitives through', () => {
    expect(expand('type Target = string').text).toBe('string')
    expect(expand('type Target = number').text).toBe('number')
    expect(expand('type Target = boolean').text).toBe('boolean')
  })

  it('keeps literal and union types exact', () => {
    expect(expand("type Target = 'a' | 'b'").text).toBe('"a" | "b"')
  })

  it('expands an anonymous object structurally', () => {
    expect(expand('type Target = { id: string; n: number }').text).toBe('{ id: string; n: number }')
  })

  it('marks optional properties optional', () => {
    expect(expand('type Target = { id?: string }').text).toBe('{ id?: string }')
  })

  it('keeps null on an optional property, dropping only undefined', () => {
    // Found by running this against a real app: `z.string().nullable()
    // .optional()` is `string | null | undefined`, and getNonNullableType
    // stripped BOTH — emitting `description?: string`, a client that rejects
    // a null the server accepts. The `?` covers undefined; null is data.
    expect(expand('type Target = { description?: string | null }').text).toBe(
      // TypeScript normalises union member order.
      '{ description?: null | string }',
    )
  })

  it('still drops undefined from a plain optional', () => {
    expect(expand('type Target = { id?: string }').text).toBe('{ id?: string }')
  })

  it('expands arrays through their element type', () => {
    expect(expand('type Target = { id: string }[]').text).toBe('{ id: string }[]')
  })

  it('parenthesises a union element so the array binds correctly', () => {
    // `string | number[]` would be a different type from `(string | number)[]`.
    expect(expand('type Target = (string | number)[]').text).toBe('(string | number)[]')
  })

  it('keeps lib types by name — every frontend already has them', () => {
    // Expanding one of these would emit hundreds of methods AND be wrong.
    // Deliberately not `Date`: it declares `toJSON()`, so it is transformed to
    // a string on the wire and has its own test below. This case is about lib
    // types that survive as themselves.
    expect(expand('type Target = { at: ArrayBuffer }').text).toBe('{ at: ArrayBuffer }')
  })

  it('hoists a named project interface instead of inlining it everywhere', () => {
    const out = expand(`
      interface Term { id: string; name: string }
      type Target = { a: Term; b: Term }
    `)
    expect(out.text).toBe('{ a: __T0; b: __T0 }')
    expect(out.hoisted).toHaveLength(1)
    expect(out.hoisted[0]).toContain('interface __T0 {')
    expect(out.hoisted[0]).toContain('id: string')
    expect(out.hoisted[0]).toContain('name: string')
  })

  it('terminates on a self-referencing type', () => {
    // Not `Node` — that would declaration-merge with the DOM lib's Node and
    // expand into it, which is a different (and correct) behaviour.
    const out = expand(`
      interface TreeNode { id: string; parent: TreeNode | null }
      type Target = TreeNode
    `)
    expect(out.text).toBe('__T0')
    // The interface referring to itself IS the termination — without the
    // reserve-name-before-expanding step this recurses forever.
    // (TypeScript normalises union member order, hence `null | __T0`.)
    expect(out.hoisted).toHaveLength(1)
    expect(out.hoisted[0]).toContain('parent: null | __T0')
  })

  it('expands a type that declaration-merges with a lib type', () => {
    // Only a type whose declarations are ALL from lib is safe to emit by
    // name. A merged one has a declaration the frontend does not have.
    const out = expand(`
      interface Node { kickExtra: string }
      type Target = { n: Node }
    `)
    expect(out.text).toBe('{ n: __T0 }')
    expect(out.hoisted[0]).toContain('kickExtra: string')
  })

  it('expands the arguments of a lib generic instead of naming them', () => {
    // Found by running this against a real 1,940-route app: `Record` is
    // declared in lib.es5, so naming the whole type emitted
    // `Record<string, SubjectCell>` into a file with no `SubjectCell` — and
    // the frontend's tsc answered `TS2304: Cannot find name 'SubjectCell'`.
    const out = expand(`
      interface Cell { score: number }
      type Target = { cells: Record<string, Cell> }
    `)
    expect(out.text).toBe('{ cells: Record<string, __T0> }')
    expect(out.text).not.toContain('Cell>')
    expect(out.hoisted[0]).toContain('score: number')
  })

  it('keeps a lib generic over primitives intact', () => {
    expect(expand('type Target = { m: Map<string, number> }').text).toBe(
      '{ m: Map<string, number> }',
    )
  })

  it('keeps ReadonlyArray readonly instead of handing back a mutable array', () => {
    // `T[]` gives the consumer a `push` the route type forbids.
    expect(expand('type Target = ReadonlyArray<string>').text).toBe('readonly string[]')
    expect(expand('type Target = readonly string[]').text).toBe('readonly string[]')
  })

  it('keeps a tuple readonly', () => {
    expect(expand('type Target = readonly [string, number]').text).toBe('readonly [string, number]')
  })

  it('keeps a readonly property readonly', () => {
    expect(expand('type Target = { readonly id: string }').text).toBe('{ readonly id: string }')
  })

  it('sees undefined through a type alias on an optional property', () => {
    // `a?: U` where `type U = string | undefined` spells no `undefined` in the
    // declaration, but accepts `{ a: undefined }` under
    // exactOptionalPropertyTypes exactly as the spelled-out form does. Reading
    // the syntax misses it; asking the checker for the declared type does not.
    const out = expand(
      `
        type U = string | undefined
        type Target = { a?: U }
      `,
      { compilerOptions: { exactOptionalPropertyTypes: true } },
    )
    expect(out.text).toBe('{ a?: undefined | string }')
  })

  it('carries values through a key-remapped mapped type (#547)', () => {
    // `as` produces SYNTHESIZED properties — no declaration at all — and the
    // old fallback asked getDeclaredTypeOfSymbol, which answers for type
    // symbols and hands back the error type for a property. Every remapped
    // field came out `any`, which is worse than the `unknown` it replaced:
    // unknown forces a cast, any silently type-checks against anything.
    const out = expand(`
      type Camel<S extends string> = S extends \`\${infer H}_\${infer M}\${infer T}\`
        ? \`\${H}\${Uppercase<M>}\${Camel<T>}\`
        : S
      type Plain = { contact_name: string; school_count: number }
      type Remap<T> = { [K in keyof T as K extends string ? Camel<K> : K]: T[K] }
      type Target = Remap<Plain>
    `)
    expect(out.text).toBe('{ contactName: string; schoolCount: number }')
    expect(out.text).not.toContain('any')
  })

  it('carries values through a composed remap over a picked row (#547)', () => {
    // The reported shape: CamelizeKeys<DateToIsoValues<Pick<Row, …>>>, which is
    // how a DTO stays bound to the table type.
    const out = expand(`
      type Camel<S extends string> = S extends \`\${infer H}_\${infer M}\${infer T}\`
        ? \`\${H}\${Uppercase<M>}\${Camel<T>}\`
        : S
      type DateToIso<V> = V extends Date ? string : V
      type DateToIsoValues<T> = { [K in keyof T]: DateToIso<T[K]> }
      type CamelizeKeys<T> = { [K in keyof T as K extends string ? Camel<K> : K]: T[K] }
      type Dto<Row> = CamelizeKeys<DateToIsoValues<Row>>
      interface Row { id: string; contact_name: string; created_at: Date; extra: number }
      type Target = Dto<Pick<Row, 'id' | 'contact_name' | 'created_at'>>
    `)
    expect(out.text).toBe('{ id: string; contactName: string; createdAt: string }')
    expect(out.text).not.toContain('any')
  })

  it('keeps a homomorphic mapped type working', () => {
    // This one always worked, but only by accident — its properties keep a
    // declaration pointing back at the source property. Pin it.
    const out = expand(`
      type Plain = { contact_name: string; school_count: number }
      type Identity<T> = { [K in keyof T]: T[K] }
      type Target = Identity<Plain>
    `)
    expect(out.text).toBe('{ contact_name: string; school_count: number }')
  })

  it('emits an index signature', () => {
    expect(expand('type Target = { [k: string]: number }').text).toBe('{ [key: string]: number }')
  })

  it('quotes a property name that is not an identifier', () => {
    expect(expand("type Target = { 'content-type': string }").text).toBe(
      '{ "content-type": string }',
    )
  })

  it('expands a tuple positionally', () => {
    expect(expand('type Target = [string, number]').text).toBe('[string, number]')
  })

  it('keeps a tuple element optional instead of making it required', () => {
    // Was `[string, undefined | number]` — one required element became two.
    expect(expand('type Target = [string, number?]').text).toBe('[string, number?]')
  })

  it('keeps a rest element variable-length', () => {
    // Was `[string, number]` — a variable-length tuple pinned to arity 2.
    expect(expand('type Target = [string, ...number[]]').text).toBe('[string, ...number[]]')
  })

  it('expands element types inside a tuple', () => {
    const out = expand(`
      interface Cell { v: number }
      type Target = [Cell, ...Cell[]]
    `)
    expect(out.text).toBe('[__T0, ...__T0[]]')
  })

  it('keeps an explicitly declared undefined on an optional property', () => {
    // Under `exactOptionalPropertyTypes` only the declared-undefined form
    // accepts `{ a: undefined }`, and the checker adds `undefined` to every
    // optional property — so the resolved type cannot tell the two apart.
    const opts = { compilerOptions: { exactOptionalPropertyTypes: true } }
    expect(expand('type Target = { a?: string | undefined }', opts).text).toBe(
      // TypeScript normalises union member order.
      '{ a?: undefined | string }',
    )
    expect(expand('type Target = { a?: string }', opts).text).toBe('{ a?: string }')
  })

  it('does not spend the depth budget on hoisted types', () => {
    // Hoisting ENDS inline nesting: each named type becomes its own top-level
    // `interface __Tn { … }` block. Carrying the caller's depth into that body
    // made a chain of named DTOs exhaust the budget on a nesting the output
    // does not contain — a real app emitted 34 "type nesting exceeded"
    // warnings, and a 15-link chain produced `interface __T12 { v: unknown }`
    // where `v` was a plain `string`. Degrading real types is worse than the
    // runaway the guard exists to stop.
    let src = ''
    for (let i = 0; i < 15; i++) src += `interface L${i} { v: string; next: L${i + 1} }\n`
    src += 'interface L15 { v: string }\ntype Target = L0\n'

    const warnings: string[] = []
    const out = expand(src, { onWarn: (m) => warnings.push(m) })

    expect(warnings).toEqual([])
    expect(out.hoisted).toHaveLength(16)
    // Every link keeps its real type, including the last one.
    expect(out.hoisted[15]).toContain('v: string')
    expect(out.hoisted.join('\n')).not.toContain('unknown')
  })

  it('still cuts off genuinely deep inline nesting', () => {
    // The case the guard is actually for: anonymous levels really do nest in
    // the emitted text, so something has to stop them.
    let t = '{ v: string }'
    for (let i = 0; i < 15; i++) t = `{ v: string; next: ${t} }`

    const warnings: string[] = []
    const out = expand(`type Target = ${t}`, { onWarn: (m) => warnings.push(m) })

    expect(warnings.length).toBeGreaterThan(0)
    expect(out.text).toContain('unknown')
  })

  it('cuts off runaway depth rather than hanging', () => {
    const out = expand('type Target = { a: { b: { c: string } } }', { maxDepth: 2 })
    expect(out.text).toContain('unknown')
  })

  it('is the shape a frontend can actually compile — no names from the program', () => {
    const out = expand(`
      interface Term { id: string; startsAt: Date }
      type Target = { params: {}; response: Term[] }
    `)
    expect(out.text).toBe('{ params: {}; response: __T0[] }')
    // `string`, not `Date` — that is what arrives over the wire.
    expect(out.hoisted.join('\n')).toContain('startsAt: string')
    expect(out.text).not.toContain('Term')
  })
})

describe('TypeExpander — expansion budget', () => {
  it('abandons an expansion that keeps hitting the depth guard', () => {
    // Depth alone was never the danger — unbounded *work* was. The guard fired
    // correctly every time on a recursive type and never bailed, so one route
    // emitted 1.66M warnings and exhausted the heap. Past the budget the walk
    // stops and says so once.
    const deep = Array.from(
      { length: 6 },
      (_, i) => `type L${i} = { a: L${i + 1}; b: L${i + 1}; c: L${i + 1} }`,
    ).join('\n')
    const warnings: string[] = []
    const out = expand(`${deep}\ntype L6 = { end: string }\ntype Target = L0`, {
      maxDepth: 2,
      truncationBudget: 3,
      onWarn: (m) => warnings.push(m),
    })
    expect(out.text).toBe('unknown')
    expect(warnings.at(-1)).toMatch(/expansion abandoned after 3/)
  })

  it('leaves an ordinary deep type alone', () => {
    const warnings: string[] = []
    const out = expand(`type Target = { a: { b: { c: string } } }`, {
      truncationBudget: 3,
      onWarn: (m) => warnings.push(m),
    })
    expect(out.text).toBe('{ a: { b: { c: string } } }')
    expect(warnings).toEqual([])
  })
})

describe('TypeExpander — what cannot survive JSON', () => {
  // A response is JSON. `JSON.stringify` drops functions and symbol keys, so a
  // method in this map describes a field the client never receives. Expanding
  // them turned one `Buffer` into a 107-member interface of `slice`/`write`/
  // `reduce` overloads — and the overloads printed through `typeToString`,
  // which elides with `...`, which is not type syntax. 34 syntax errors, and
  // the whole map stopped parsing.
  it('drops methods and function-valued properties', () => {
    const out = expand(`
      type Target = {
        name: string
        save(): void
        onDone: (x: number) => void
        nested: { id: string; run(): number }
      }
    `)
    expect(out.text).toContain('name: string')
    expect(out.text).toContain('id: string')
    expect(out.text).not.toContain('save')
    expect(out.text).not.toContain('onDone')
    expect(out.text).not.toContain('run')
    expect(out.text).not.toContain('=>')
  })

  it('drops well-known symbol keys, whose printed name is compiler state', () => {
    // The checker prints these as `__@toStringTag@138` — the suffix is an
    // internal id, so it is neither indexable by a client nor stable to hash.
    const out = expand(`
      type Target = { readonly [Symbol.toStringTag]: 'Thing'; a: string }
    `)
    expect(out.text).toContain('a: string')
    expect(out.text).not.toContain('__@')
  })

  // Smoke check, not a regression test: dropping methods removes the only path
  // that reached `typeToString` with something long enough to elide, so this
  // passes with the NoTruncation flag off. The flag stays because the invariant
  // is unconditional — truncated output is never valid type syntax — and
  // because it is the last line of defence if a long type reaches the printer
  // by some route this suite does not model.
  it('never emits an elision, whatever the type', () => {
    const out = expand(`type Target = { d: Uint8Array; b: ArrayBuffer }`)
    expect(out.text).not.toContain('...')
    for (const block of out.hoisted) expect(block).not.toContain('...')
  })

  it('keeps a data-only object untouched', () => {
    const out = expand(`type Target = { a: string; b: { c: number } }`)
    expect(out.text).toBe('{ a: string; b: { c: number } }')
  })
})

describe('TypeExpander — what JSON transforms', () => {
  // Dropping what JSON drops is only half the rule. `JSON.stringify` also
  // *calls* `toJSON()`, so for those types the wire shape is that method's
  // return type. Emitting the type itself type-checks and then lies: a map
  // saying `Date` lets `r.createdAt.getFullYear()` compile against a value
  // that is a string at runtime. One app had 496 of them.
  it('emits Date as the string the client actually receives', () => {
    const out = expand(`type Target = { createdAt: Date; deletedAt: Date | null }`)
    expect(out.text).toBe('{ createdAt: string; deletedAt: null | string }')
  })

  it('uses a custom toJSON return type over the object itself', () => {
    const out = expand(`
      declare class Money { amount: number; currency: string; toJSON(): { cents: number } }
      type Target = { total: Money }
    `)
    expect(out.text).toContain('cents: number')
    expect(out.text).not.toContain('currency')
  })

  it('leaves a type without toJSON alone', () => {
    const out = expand(`type Target = { a: { b: string } }`)
    expect(out.text).toBe('{ a: { b: string } }')
  })
})
