import * as view from '@forinda/kickjs-view'
import { describe, expect, it } from 'vitest'
import { formatEdits } from '../src/plugin/format'

describe('formatEdits', () => {
  it('one whole-document edit', () => {
    const text = '@if(a){\n<p>x</p>\n}'
    const edits = formatEdits(view, text, 'page.kick', 2)
    expect(edits).toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
        newText: '@if (a) {\n  <p>x</p>\n}\n',
      },
    ])
  })
  it('nothing on a parse error', () => {
    expect(formatEdits(view, '@if (a) {\n<p>', 'page.kick', 2)).toEqual([])
  })
  it('nothing when already formatted', () => {
    expect(formatEdits(view, '@if (a) {\n  <p>x</p>\n}\n', 'page.kick', 2)).toEqual([])
  })
})
