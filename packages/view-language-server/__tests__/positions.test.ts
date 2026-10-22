import { describe, expect, it } from 'vitest'
import { toPosition, toRange } from '../src/positions'

describe('positions', () => {
  it('engine 1-based to LSP 0-based', () => {
    expect(toPosition({ offset: 0, line: 1, column: 1 })).toEqual({ line: 0, character: 0 })
    expect(
      toRange({ start: { offset: 4, line: 2, column: 3 }, end: { offset: 9, line: 2, column: 8 } }),
    ).toEqual({ start: { line: 1, character: 2 }, end: { line: 1, character: 7 } })
  })

  it('UTF-16 columns pass through unchanged', () => {
    // '👋' is two UTF-16 units: the engine reports column 4 for what follows "a👋".
    expect(toPosition({ offset: 3, line: 1, column: 4 })).toEqual({ line: 0, character: 3 })
  })
})
