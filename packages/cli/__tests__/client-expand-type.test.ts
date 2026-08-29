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
function expand(source: string, opts: { maxDepth?: number } = {}) {
  const file = join(dir, `case-${Math.random().toString(36).slice(2)}.ts`)
  writeFileSync(file, source)

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
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

  it('expands arrays through their element type', () => {
    expect(expand('type Target = { id: string }[]').text).toBe('{ id: string }[]')
  })

  it('parenthesises a union element so the array binds correctly', () => {
    // `string | number[]` would be a different type from `(string | number)[]`.
    expect(expand('type Target = (string | number)[]').text).toBe('(string | number)[]')
  })

  it('keeps lib types by name — every frontend already has them', () => {
    // Expanding Date would emit hundreds of methods AND be wrong.
    expect(expand('type Target = { at: Date }').text).toBe('{ at: Date }')
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
    expect(out.hoisted.join('\n')).toContain('startsAt: Date')
    expect(out.text).not.toContain('Term')
  })
})
