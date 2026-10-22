/** The engine's 1-based line/column (UTF-16 units) to LSP's 0-based positions. */
import type { Position, Range } from '@volar/language-service'
import type { Pos, Span } from '@forinda/kickjs-view'

export const toPosition = (pos: Pos): Position => ({
  line: pos.line - 1,
  character: pos.column - 1,
})

export const toRange = (span: Span): Range => ({
  start: toPosition(span.start),
  end: toPosition(span.end),
})
