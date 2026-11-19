/** The guide's `.kick` examples parse cleanly — a reader can copy them. */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse/template'

// The overview and every page under docs/guide/views/.
const DOCS = resolve(import.meta.dirname, '../../../docs/guide')
const pages = [
  join(DOCS, 'views.md'),
  ...readdirSync(join(DOCS, 'views'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(DOCS, 'views', f)),
]
const examples = pages.flatMap((p) =>
  [...readFileSync(p, 'utf8').matchAll(/```kick\n([\s\S]*?)\n```/g)].map((m) => m[1]!),
)

describe('docs/guide/views', () => {
  it('has .kick examples', () => {
    expect(examples.length).toBeGreaterThan(0)
  })
  for (const [i, src] of examples.entries()) {
    it(`example ${i + 1} parses without diagnostics`, () => {
      expect(parse(src, `example-${i + 1}.kick`).diagnostics.map((d) => d.message)).toEqual([])
    })
  }
})
