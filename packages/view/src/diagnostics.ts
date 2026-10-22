/** A point in a template: 0-based offset, 1-based line and column (UTF-16 units). */
export interface Pos {
  offset: number
  line: number
  column: number
}

export interface Span {
  start: Pos
  end: Pos
}

export interface Diagnostic {
  file: string
  span: Span
  message: string
  severity: 'error' | 'warning'
  /** The templates being rendered, outermost first, when the error came from a render. */
  stack?: string[]
}

/**
 * The position `upTo` characters into `text`, which starts at `base`.
 * CRLF counts as one line break, as does a lone CR.
 */
export function advance(base: Pos, text: string, upTo: number): Pos {
  let { line, column } = base
  for (let i = 0; i < upTo; i++) {
    const c = text.charCodeAt(i)
    if (c === 10 /* \n */) {
      line++
      column = 1
    } else if (c === 13 /* \r */) {
      if (text.charCodeAt(i + 1) !== 10) {
        line++
        column = 1
      }
    } else {
      column++
    }
  }
  return { offset: base.offset + upTo, line, column }
}

export const START: Pos = { offset: 0, line: 1, column: 1 }

/** The position of `offset` in `source`. */
export const positionAt = (source: string, offset: number): Pos => advance(START, source, offset)

export const error = (file: string, span: Span, message: string): Diagnostic => ({
  file,
  span,
  message,
  severity: 'error',
})

export const warning = (file: string, span: Span, message: string): Diagnostic => ({
  file,
  span,
  message,
  severity: 'warning',
})
