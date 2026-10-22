import { describe, expect, it } from 'vitest'
import { parseExpression, type Expr } from '../src/parse/expression'

const BASE = { offset: 0, line: 1, column: 1 }

/** A compact, readable form of an expression tree. */
function show(e: Expr): string {
  switch (e.kind) {
    case 'literal':
      return JSON.stringify(e.value)
    case 'path':
      return (
        e.root +
        e.segments
          .map(
            (s) => (s.optional ? '?' : '') + (s.computed ? `[${show(s.computed)}]` : `.${s.name}`),
          )
          .join('')
      )
    case 'unary':
      return `(${e.op} ${show(e.arg)})`
    case 'binary':
    case 'logical':
      return `(${e.op} ${show(e.left)} ${show(e.right)})`
    case 'conditional':
      return `(? ${show(e.test)} ${show(e.whenTrue)} ${show(e.whenFalse)})`
    case 'pipe':
      return `(| ${show(e.input)} ${e.name}${e.args.map((a) => ' ' + show(a)).join('')})`
  }
}

function ok(src: string): string {
  const { expr, diagnostics } = parseExpression(src, 't.kick', BASE)
  expect(diagnostics).toEqual([])
  return show(expr!)
}

function fails(src: string) {
  const { expr, diagnostics } = parseExpression(src, 't.kick', BASE)
  expect(expr).toBeUndefined()
  expect(diagnostics).toHaveLength(1)
  expect(diagnostics[0]!.severity).toBe('error')
  return diagnostics[0]!
}

describe('parseExpression', () => {
  it('parses the precedence table', () => {
    expect(ok('a ? b : c | x')).toBe('(| (? a b c) x)')
    expect(ok('a || b && c')).toBe('(|| a (&& b c))')
    expect(ok('-a + b')).toBe('(+ (- a) b)')
    expect(ok('a ?? b || c')).toBe('(?? a (|| b c))')
    expect(ok('a == b && c < d')).toBe('(&& (== a b) (< c d))')
    expect(ok('a + 1 < b')).toBe('(< (+ a 1) b)')
    expect(ok('!a.b')).toBe('(! a.b)')
    expect(ok('(a || b) && c')).toBe('(&& (|| a b) c)')
  })

  it('parses paths', () => {
    const { expr } = parseExpression('a?.b[0][key]?.[k]', 't.kick', BASE)
    expect(expr!.kind).toBe('path')
    if (expr!.kind !== 'path') return
    expect(expr!.root).toBe('a')
    expect(expr!.segments.map((s) => s.optional)).toEqual([true, false, false, true])
    expect(show(expr!)).toBe('a?.b[0][key]?[k]')
  })

  it('parses string escapes and numbers', () => {
    expect(ok("'a\\'b\\u00e9'")).toBe(JSON.stringify("a'bé"))
    expect(ok('"x\\n\\t\\\\"')).toBe(JSON.stringify('x\n\t\\'))
    expect(ok('-1.5')).toBe('(- 1.5)')
    expect(ok('true')).toBe('true')
    expect(ok('null')).toBe('null')
  })

  it('pipe args bind tighter', () => {
    expect(ok('x | slice:1:2 | upper')).toBe('(| (| x slice 1 2) upper)')
    expect(ok("price | currency:'KES':2")).toBe('(| price currency "KES" 2)')
    expect(fails('x | slice:a ? 1 : 2').message).toContain('parentheses')
  })

  it('rejects forbidden syntax', () => {
    const cases: Array<[string, string]> = [
      ['a()', '('],
      ['a.b()', '('],
      ['new a', 'new'],
      ['a = 1', '='],
      ['a * 2', '*'],
      ['a / 2', '/'],
      ['a % 2', '%'],
      ['`t`', '`'],
      ['x => x', '=>'],
      ['{}', '{'],
      ['[1]', '['],
      ['...a', '...'],
      ['typeof a', 'typeof'],
      ['a in b', 'in'],
      ['delete a', 'delete'],
    ]
    for (const [src, token] of cases) {
      const d = fails(src)
      expect(d.span.start.offset, src).toBe(src.indexOf(token))
    }
  })

  it('rejects forbidden names', () => {
    for (const src of ['a.__proto__', 'a.constructor', 'a.prototype', 'a.__lookupGetter__']) {
      expect(fails(src).message, src).toContain('not allowed')
    }
    expect(ok("a['constructor']")).toBe('a["constructor"]')
  })

  it('reports positions relative to the base', () => {
    const { diagnostics } = parseExpression('a()', 't.kick', { offset: 10, line: 3, column: 5 })
    expect(diagnostics[0]!.span.start).toEqual({ offset: 11, line: 3, column: 6 })
  })
})
