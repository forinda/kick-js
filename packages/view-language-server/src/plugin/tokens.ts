/**
 * Semantic tokens for `.kick` templates, so every LSP editor highlights the
 * template syntax, not only VS Code with its TextMate grammar. Found by a
 * lexical scan, like the language plugin's: the buffer being typed in rarely
 * parses.
 */
import { closeInterp, closeParen, KEYWORD, letEnd, verbatimEnd } from '../language-plugin'

/** The legend, in order: standard types, so themes colour them. */
export const TOKEN_TYPES = [
  'keyword',
  'comment',
  'operator',
  'function',
  'variable',
  'property',
  'string',
  'number',
  'class',
  'parameter',
] as const

export type TokenType = (typeof TOKEN_TYPES)[number]

export interface KickToken {
  offset: number
  length: number
  type: TokenType
}

const LITERALS = new Set(['true', 'false', 'null', 'undefined'])
/** Words with a meaning in block headers: `@for (x of xs; track x.id; let i = $index)`, `@if (a; as b)`, `@layout(none)`. */
const HEADER_WORDS = new Set(['of', 'track', 'let', 'as', 'none'])

export function kickTokens(s: string, isComponent: (tag: string) => boolean): KickToken[] {
  const out: KickToken[] = []
  const push = (offset: number, length: number, type: TokenType) => {
    if (length > 0) out.push({ offset, length, type })
  }

  /** An expression in `[from, to)`. */
  const expr = (from: number, to: number, header: boolean) => {
    let prev = ''
    for (let i = from; i < to;) {
      const c = s[i]!
      if (/\s/.test(c)) {
        i++
        continue
      }
      if (c === "'" || c === '"' || c === '`') {
        let j = i + 1
        while (j < to && s[j] !== c) j += s[j] === '\\' ? 2 : 1
        j = Math.min(j + 1, to)
        push(i, j - i, 'string')
        prev = 'lit'
        i = j
        continue
      }
      const num = /^\d+(?:\.\d+)?/.exec(s.slice(i, Math.min(to, i + 32)))
      if (num) {
        push(i, num[0].length, 'number')
        prev = 'lit'
        i += num[0].length
        continue
      }
      const word = /^[A-Za-z_$][\w$]*/.exec(s.slice(i, Math.min(to, i + 128)))
      if (word) {
        const w = word[0]
        const type: TokenType =
          prev === '.'
            ? 'property'
            : prev === '|'
              ? 'function'
              : LITERALS.has(w) || (header && HEADER_WORDS.has(w))
                ? 'keyword'
                : 'variable'
        push(i, w.length, type)
        prev = 'word'
        i += w.length
        continue
      }
      if (c === '|' && s[i + 1] === '|') {
        prev = '||'
        i += 2
        continue
      }
      if (c === '|') push(i, 1, 'operator')
      // `?.` reads as `.`: the name after it is a property.
      prev = c === '?' && s[i + 1] === '.' ? '.' : c
      i += c === '?' && s[i + 1] === '.' ? 2 : 1
    }
  }

  /** `{{ … }}` from `i` (at `{{`); returns its end. */
  const interp = (i: number, limit: number) => {
    const end = Math.min(closeInterp(s, i), limit)
    const closed = s.startsWith('}}', end - 2) && end - 2 >= i + 2
    push(i, 2, 'operator')
    expr(i + 2, closed ? end - 2 : end, false)
    if (closed) push(end - 2, 2, 'operator')
    return end
  }

  /** One tag from `i` (at `<`); returns where scanning continues. */
  const tag = (i: number) => {
    const m = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(s.slice(i, i + 64))!
    const name = m[2]!.toLowerCase()
    if (isComponent(name)) push(i + 1 + m[1]!.length, m[2]!.length, 'class')
    let j = i + m[0].length
    while (j < s.length && s[j] !== '>') {
      const binding = /^\[([^\]\s]+)\]\s*=\s*(["'])/.exec(s.slice(j, j + 128))
      if (binding) {
        push(j + 1, binding[1]!.length, 'property')
        const from = j + binding[0].length
        const close = s.indexOf(binding[2]!, from)
        const stop = close < 0 ? s.length : close
        expr(from, stop, false)
        j = stop + 1
        continue
      }
      const q = s[j]
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, j + 1)
        const stop = close < 0 ? s.length : close
        for (let k = j + 1; k < stop; k++) if (s.startsWith('{{', k)) k = interp(k, stop) - 1
        j = stop + 1
        continue
      }
      j++
    }
    j = Math.min(j + 1, s.length)
    if (m[1] || (name !== 'script' && name !== 'style') || s[j - 2] === '/') return j
    // Raw text: only `{{ }}` (a JSON script's value) is template syntax.
    const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'i').exec(s.slice(j))
    const end = close ? j + close.index : s.length
    for (let k = j; k < end; k++) if (s.startsWith('{{', k)) k = interp(k, end) - 1
    return end
  }

  let i = 0
  while (i < s.length) {
    const c = s[i]!
    if (s.startsWith('{{--', i)) {
      const end = s.indexOf('--}}', i + 4)
      const stop = end < 0 ? s.length : end + 4
      push(i, stop - i, 'comment')
      i = stop
      continue
    }
    if (s.startsWith('{{', i)) {
      i = interp(i, s.length)
      continue
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4)
      i = end < 0 ? s.length : end + 3
      continue
    }
    if (c === '<' && /^<\/?[A-Za-z]/.test(s.slice(i, i + 3))) {
      i = tag(i)
      continue
    }
    if (c === '@' && !/[\w@.-]/.test(s[i - 1] ?? '')) {
      const m = KEYWORD.exec(s.slice(i, i + 16))
      if (m) {
        const kw = m[1]!.replace(/\s+/g, ' ')
        push(i, m[0].length, 'keyword')
        let j = i + m[0].length
        if (kw === 'input' || kw === 'let') {
          const decl = /^\s+([\w$]+)/.exec(s.slice(j, j + 64))
          if (decl)
            push(
              j + decl[0].length - decl[1]!.length,
              decl[1]!.length,
              kw === 'input' ? 'parameter' : 'variable',
            )
          const eol = s.indexOf('\n', j)
          const stop = kw === 'let' ? letEnd(s, j).at : eol < 0 ? s.length : eol
          const eq = s.indexOf('=', j)
          if (eq >= 0 && eq < stop) expr(eq + 1, stop, false)
          i = stop
          continue
        }
        while (j < s.length && /\s/.test(s[j]!)) j++
        if (kw === 'verbatim' && s[j] === '{') {
          i = verbatimEnd(s, j)
          continue
        }
        if (s[j] === '(') {
          const end = closeParen(s, j)
          expr(j + 1, s[end - 1] === ')' ? end - 1 : end, true)
          i = end
          continue
        }
        i = i + m[0].length
        continue
      }
    }
    i++
  }
  return out
}
