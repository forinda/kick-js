/** Agent skills as text files in scaffold layers: base renders as before, layers add theirs. */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateKickJsSkillFiles } from '../src/generators/templates/project-docs'
import { readLayerSkills, skillVars } from '../src/scaffold/skills'

// The rendered SKILL.md of every base skill before the move, as text: formatters leave .txt alone.
const FIXTURES = join(import.meta.dirname, 'fixtures/skills')

describe('layer skills', () => {
  for (const variant of readdirSync(FIXTURES)) {
    it(`base skills render byte-identically (${variant})`, () => {
      const [pm, style] = variant.split('-') as [string, 'define' | 'class']
      const out = generateKickJsSkillFiles('demo', 'minimal', pm, style)
      const expected = readdirSync(join(FIXTURES, variant)).toSorted()
      expect(out.map((f) => `${f.slug}.txt`).toSorted()).toEqual(expected)
      for (const f of out)
        expect(f.content, f.slug).toBe(
          readFileSync(join(FIXTURES, variant, `${f.slug}.txt`), 'utf8'),
        )
    })
  }

  it('no layers means no views skills', () => {
    const slugs = generateKickJsSkillFiles('demo', 'minimal', 'pnpm', 'define').map((f) => f.slug)
    expect(slugs).not.toContain('views')
  })

  it('unknown placeholders are left alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-skills-'))
    mkdirSync(join(dir, 'feature-x/skills'), { recursive: true })
    writeFileSync(
      join(dir, 'feature-x/skills/x.txt'),
      '---\nname: kickjs-x\ndescription: Use for x.\n---\n\n{{ user.name }} with {{pm}} and {{kick}}\n',
    )
    const [skill] = readLayerSkills(['feature-x'], skillVars('npm', 'define'), dir)
    expect(skill).toEqual({
      slug: 'x',
      name: 'kickjs-x',
      description: 'Use for x.',
      body: '{{ user.name }} with npm and npx kick',
    })
  })
})
