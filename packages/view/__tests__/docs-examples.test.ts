/** The guide's `.kick` examples parse cleanly — a reader can copy them. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse/template'

const guide = readFileSync(resolve(import.meta.dirname, '../../../docs/guide/views.md'), 'utf8')
const examples = [...guide.matchAll(/```kick\n([\s\S]*?)\n```/g)].map((m) => m[1]!)

describe('docs/guide/views.md', () => {
  it('has .kick examples', () => {
    expect(examples.length).toBeGreaterThan(0)
  })
  for (const [i, src] of examples.entries()) {
    it(`example ${i + 1} parses without diagnostics`, () => {
      expect(parse(src, `example-${i + 1}.kick`).diagnostics.map((d) => d.message)).toEqual([])
    })
  }
})
