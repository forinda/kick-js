/**
 * The `.kick` grammar: snapshot per fixture (as Vue's language tools test
 * theirs), plus scope assertions so a wrong first snapshot can't be accepted.
 */
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createGrammarSnapshot } from 'vscode-tmlanguage-snapshot'

const require = createRequire(import.meta.url)
const fixtures = resolve(import.meta.dirname, 'grammarFixtures')
const grammar = (name: string) => require.resolve(`tm-grammars/grammars/${name}.json`)

let snapshot: (path: string) => Promise<string>

beforeAll(async () => {
  snapshot = await createGrammarSnapshot(resolve(import.meta.dirname, '../package.json'), {
    extraGrammarPaths: [grammar('html'), grammar('css'), grammar('javascript')],
  })
})

describe('kick grammar', () => {
  it('scopes interpolation and pipes', async () => {
    const out = await snapshot('__tests__/grammarFixtures/interpolation.kick')
    expect(out).toContain('punctuation.definition.interpolation.begin.kick')
    expect(out).toContain('meta.interpolation.kick')
    expect(out).toMatch(/titlecase[\s\S]*?entity\.name\.function\.pipe\.kick/)
    expect(out).toMatch(/currency[\s\S]*?entity\.name\.function\.pipe\.kick/)
  })

  it('scopes control flow', async () => {
    const out = await snapshot('__tests__/grammarFixtures/control-flow.kick')
    // Each keyword line's first token (columns 1..n) carries keyword.control.kick.
    for (const kw of [
      '@layout',
      '@if',
      '@else if',
      '@else',
      '@for',
      '@empty',
      '@switch',
      '@case',
      '@default',
      '@let',
    ]) {
      expect(out, kw).toMatch(
        new RegExp(
          `>\\s*(?:\\} )?${kw}[^\\n]*\\n(?:#[^\\n]*\\n)*?#\\s*\\^+ [^\\n]*keyword\\.control\\.kick`,
        ),
      )
    }
  })

  it('leaves @ in text and attributes alone', async () => {
    const out = await snapshot('__tests__/grammarFixtures/not-keywords.kick')
    expect(out).not.toContain('keyword.control.kick')
  })

  it('scopes bindings', async () => {
    const out = await snapshot('__tests__/grammarFixtures/bindings.kick')
    expect(out).toContain('entity.other.attribute-name.binding.kick')
    // The bound value is an expression, not an HTML error.
    expect(out).not.toContain('invalid.illegal')
    expect(out).toMatch(/!ok[\s\S]*?meta\.binding-value\.kick|meta\.binding-value\.kick/)
  })

  it('template comments are one comment', async () => {
    const out = await snapshot('__tests__/grammarFixtures/comments.kick')
    expect(out).toContain('comment.block.template.kick')
    expect(out).not.toContain('meta.interpolation.kick')
  })

  it('verbatim content is not template syntax', async () => {
    const out = await snapshot('__tests__/grammarFixtures/verbatim.kick')
    const [inside, after] = out.split(/<p>/)
    expect(inside).not.toContain('meta.interpolation.kick')
    expect(after).toContain('meta.interpolation.kick')
  })

  for (const fixture of readdirSync(fixtures)) {
    it(`snapshot: ${fixture}`, async () => {
      expect(await snapshot(`__tests__/grammarFixtures/${fixture}`)).toMatchSnapshot()
    })
  }
})
