/**
 * The template expression language: property paths, literals, comparisons,
 * logic, `??`, the ternary and pipes. Nothing that calls, assigns or
 * constructs — a template reads data, the controller computes it.
 */
import type { Expr, PathSegment } from '../ast'
import { advance, error, type Diagnostic, type Pos, type Span } from '../diagnostics'

export type { Expr } from '../ast'

/** Property names a template never reads, even through `[...]` (checked at runtime). */
export const FORBIDDEN_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
])

const KEYWORDS: Record<string, string> = {
  new: 'constructing objects',
  typeof: '`typeof`',
  instanceof: '`instanceof`',
  in: '`in`',
  delete: '`delete`',
  void: '`void`',
  function: 'functions',
  class: 'classes',
  await: '`await`',
  yield: '`yield`',
  this: '`this`',
}

/** Characters and operators the language has no place for, with why. */
const FORBIDDEN_PUNCT: Record<string, string> = {
  '(': 'calls',
  '=': 'assignment',
  '=>': 'functions',
  '*': '`*`',
  '/': '`/`',
  '%': '`%`',
  '`': 'template literals',
  '{': 'object literals',
  '}': '`}`',
  '...': 'spread',
  ';': '`;`',
  ',': '`,`',
  '&': '`&`',
  '^': '`^`',
  '~': '`~`',
}

// Longest first, so `===` wins over `==` over `=`.
const PUNCT = [
  '===',
  '!==',
  '...',
  '?.',
  '??',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '=>',
  '?',
  ':',
  '|',
  '!',
  '<',
  '>',
  '+',
  '-',
  '.',
  '[',
  ']',
  '(',
  ')',
  '=',
  '*',
  '/',
  '%',
  '`',
  '{',
  '}',
  ';',
  ',',
  '&',
  '^',
  '~',
]

type Token =
  | { t: 'ident'; v: string; start: number; end: number }
  | { t: 'num'; v: number; start: number; end: number }
  | { t: 'str'; v: string; start: number; end: number }
  | { t: 'punct'; v: string; start: number; end: number }
  | { t: 'eof'; v: ''; start: number; end: number }

class Fail extends Error {
  constructor(
    readonly start: number,
    readonly end: number,
    message: string,
  ) {
    super(message)
  }
}

const ESCAPES: Record<string, string> = {
  '\\': '\\',
  "'": "'",
  '"': '"',
  n: '\n',
  t: '\t',
  r: '\r',
}

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    const start = i
    if (/[A-Za-z_$]/.test(c)) {
      while (i < src.length && /[\w$]/.test(src[i]!)) i++
      out.push({ t: 'ident', v: src.slice(start, i), start, end: i })
      continue
    }
    if (/\d/.test(c)) {
      while (i < src.length && /\d/.test(src[i]!)) i++
      if (src[i] === '.' && /\d/.test(src[i + 1] ?? '')) {
        i++
        while (i < src.length && /\d/.test(src[i]!)) i++
      }
      out.push({ t: 'num', v: Number(src.slice(start, i)), start, end: i })
      continue
    }
    if (c === "'" || c === '"') {
      let v = ''
      i++
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') {
          const e = src[i + 1] ?? ''
          if (e === 'u') {
            const hex = src.slice(i + 2, i + 6)
            if (!/^[0-9a-fA-F]{4}$/.test(hex))
              throw new Fail(i, i + 2, 'a \\u escape needs four hex digits')
            v += String.fromCharCode(parseInt(hex, 16))
            i += 6
            continue
          }
          if (!(e in ESCAPES)) throw new Fail(i, i + 2, `unknown escape \\${e}`)
          v += ESCAPES[e]
          i += 2
          continue
        }
        v += src[i]
        i++
      }
      if (i >= src.length) throw new Fail(start, i, 'unterminated string')
      i++
      out.push({ t: 'str', v, start, end: i })
      continue
    }
    const p = PUNCT.find((op) => src.startsWith(op, i))
    if (!p) throw new Fail(i, i + 1, `unexpected character '${c}'`)
    i += p.length
    out.push({ t: 'punct', v: p, start, end: i })
  }
  out.push({ t: 'eof', v: '', start: src.length, end: src.length })
  return out
}

// Binding powers, lowest first (spec §3): pipe, ternary, ??, ||, &&, equality,
// relational, additive, unary, member.
const BP = { pipe: 1, ternary: 2, nullish: 3, or: 4, and: 5, eq: 6, rel: 7, add: 8, unary: 9 }

const BINARY: Record<string, [number, Expr['kind']]> = {
  '??': [BP.nullish, 'logical'],
  '||': [BP.or, 'logical'],
  '&&': [BP.and, 'logical'],
  '==': [BP.eq, 'binary'],
  '!=': [BP.eq, 'binary'],
  '===': [BP.eq, 'binary'],
  '!==': [BP.eq, 'binary'],
  '<': [BP.rel, 'binary'],
  '>': [BP.rel, 'binary'],
  '<=': [BP.rel, 'binary'],
  '>=': [BP.rel, 'binary'],
  '+': [BP.add, 'binary'],
  '-': [BP.add, 'binary'],
}

class Parser {
  private i = 0
  constructor(
    private readonly src: string,
    private readonly base: Pos,
    private readonly tokens: Token[],
  ) {}

  private peek(): Token {
    return this.tokens[this.i]!
  }
  private next(): Token {
    return this.tokens[this.i++]!
  }
  private span(start: number, end: number): Span {
    return { start: advance(this.base, this.src, start), end: advance(this.base, this.src, end) }
  }
  private isPunct(v: string): boolean {
    const t = this.peek()
    return t.t === 'punct' && t.v === v
  }
  private expect(v: string): Token {
    const t = this.peek()
    if (t.t !== 'punct' || t.v !== v) {
      throw new Fail(
        t.start,
        t.end,
        t.t === 'eof' ? `expected '${v}'` : `expected '${v}', found '${this.text(t)}'`,
      )
    }
    return this.next()
  }
  private text(t: Token): string {
    return this.src.slice(t.start, t.end)
  }
  private forbidden(t: Token): never {
    const what = t.t === 'punct' ? FORBIDDEN_PUNCT[t.v] : KEYWORDS[t.v]
    throw new Fail(t.start, t.end, `${what ?? `'${this.text(t)}'`} aren't allowed in templates`)
  }

  parseAll(): Expr {
    const e = this.expr(0)
    const t = this.peek()
    if (t.t !== 'eof') {
      if ((t.t === 'punct' && t.v in FORBIDDEN_PUNCT) || (t.t === 'ident' && t.v in KEYWORDS)) {
        this.forbidden(t)
      }
      throw new Fail(t.start, t.end, `unexpected '${this.text(t)}'`)
    }
    return e
  }

  private expr(min: number): Expr {
    let left = this.prefix()
    for (;;) {
      const t = this.peek()
      if (t.t === 'ident' && (t.v === 'in' || t.v === 'instanceof')) this.forbidden(t)
      if (t.t !== 'punct') break
      if (t.v === '|') {
        if (min > BP.pipe) break
        this.next()
        const name = this.next()
        if (name.t !== 'ident') throw new Fail(name.start, name.end, 'expected a pipe name after |')
        const args: Expr[] = []
        while (this.isPunct(':')) {
          this.next()
          args.push(this.expr(BP.nullish))
          if (this.isPunct('?')) {
            const q = this.peek()
            throw new Fail(q.start, q.end, 'wrap a conditional pipe argument in parentheses')
          }
        }
        left = { kind: 'pipe', input: left, name: name.v, args, span: this.join(left, name.end) }
        continue
      }
      if (t.v === '?') {
        if (min > BP.ternary) break
        this.next()
        const whenTrue = this.expr(BP.ternary)
        this.expect(':')
        const whenFalse = this.expr(BP.ternary)
        left = {
          kind: 'conditional',
          test: left,
          whenTrue,
          whenFalse,
          span: this.joinExpr(left, whenFalse),
        }
        continue
      }
      const bin = BINARY[t.v]
      if (bin) {
        const [bp, kind] = bin
        if (bp < min) break
        this.next()
        const right = this.expr(bp + 1)
        left = { kind, op: t.v, left, right, span: this.joinExpr(left, right) } as Expr
        continue
      }
      if (t.v in FORBIDDEN_PUNCT) this.forbidden(t)
      break
    }
    return left
  }

  private join(left: Expr, end: number): Span {
    return { start: left.span.start, end: advance(this.base, this.src, end) }
  }
  private joinExpr(left: Expr, right: Expr): Span {
    return { start: left.span.start, end: right.span.end }
  }

  private prefix(): Expr {
    const t = this.next()
    switch (t.t) {
      case 'num':
        return { kind: 'literal', value: t.v, span: this.span(t.start, t.end) }
      case 'str':
        return { kind: 'literal', value: t.v, span: this.span(t.start, t.end) }
      case 'ident': {
        if (t.v in KEYWORDS) this.forbidden(t)
        if (t.v === 'true' || t.v === 'false') {
          return { kind: 'literal', value: t.v === 'true', span: this.span(t.start, t.end) }
        }
        if (t.v === 'null') return { kind: 'literal', value: null, span: this.span(t.start, t.end) }
        if (FORBIDDEN_NAMES.has(t.v))
          throw new Fail(t.start, t.end, `'${t.v}' is not allowed in templates`)
        return this.path(t)
      }
      case 'punct': {
        if (t.v === '!' || t.v === '-') {
          const arg = this.expr(BP.unary)
          return {
            kind: 'unary',
            op: t.v,
            arg,
            span: { start: this.span(t.start, t.end).start, end: arg.span.end },
          }
        }
        if (t.v === '(') {
          const e = this.expr(0)
          this.expect(')')
          if (this.isPunct('.') || this.isPunct('[') || this.isPunct('?.')) {
            const m = this.peek()
            throw new Fail(
              m.start,
              m.end,
              'property access needs a name in front: (…).x is not allowed',
            )
          }
          return e
        }
        if (t.v === '[')
          throw new Fail(t.start, t.end, "array literals aren't allowed in templates")
        if (t.v in FORBIDDEN_PUNCT) this.forbidden(t)
        throw new Fail(t.start, t.end, `unexpected '${t.v}'`)
      }
      case 'eof':
        throw new Fail(t.start, t.end, 'expected an expression')
    }
  }

  private path(root: Token & { t: 'ident' }): Expr {
    const segments: PathSegment[] = []
    let end = root.end
    for (;;) {
      const t = this.peek()
      if (t.t !== 'punct') break
      if (t.v === '.' || t.v === '?.') {
        this.next()
        const optional = t.v === '?.'
        if (optional && this.isPunct('[')) {
          this.next()
          const computed = this.expr(0)
          end = this.expect(']').end
          segments.push({ computed, optional })
          continue
        }
        if (optional && this.isPunct('(')) this.forbidden(this.peek())
        const name = this.next()
        if (name.t !== 'ident') throw new Fail(name.start, name.end, 'expected a property name')
        if (FORBIDDEN_NAMES.has(name.v)) {
          throw new Fail(name.start, name.end, `'${name.v}' is not allowed in templates`)
        }
        segments.push({ name: name.v, optional })
        end = name.end
        continue
      }
      if (t.v === '[') {
        this.next()
        const computed = this.expr(0)
        end = this.expect(']').end
        segments.push({ computed, optional: false })
        continue
      }
      if (t.v === '(') this.forbidden(t)
      break
    }
    return { kind: 'path', root: root.v, segments, span: this.span(root.start, end) }
  }
}

/**
 * Parse one expression. `base` is where `src` starts in the template, so
 * positions in diagnostics and spans point into the template file.
 */
export function parseExpression(
  src: string,
  file: string,
  base: Pos,
): { expr?: Expr; diagnostics: Diagnostic[] } {
  try {
    const tokens = tokenize(src)
    return { expr: new Parser(src, base, tokens).parseAll(), diagnostics: [] }
  } catch (err) {
    if (!(err instanceof Fail)) throw err
    const span = { start: advance(base, src, err.start), end: advance(base, src, err.end) }
    return { diagnostics: [error(file, span, err.message)] }
  }
}
