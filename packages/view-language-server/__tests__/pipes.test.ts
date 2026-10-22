import { describe, expect, it } from 'vitest'
import { pipeDeclarations } from '../src/pipes'

describe('pipeDeclarations', () => {
  it("takes the name's column from the declaration, not the keyword", () => {
    const decls = pipeDeclarations(
      'export const t = (k: string) => k\nexport function on(x) { return x }',
    )
    expect(decls.get('t')).toMatchObject({ line: 0, column: 13, signature: 't(k: string)' })
    expect(decls.get('on')).toMatchObject({ line: 1, column: 16, signature: 'on(x)' })
  })
})
