/** Agent skills as text files in scaffold layers: base renders as before, layers add theirs. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateKickJsSkillFiles } from '../src/generators/templates/project-docs'
import { generateAgentDocs, writeLayerSkills } from '../src/generators/agent-docs'
import { detectFeatureLayers, readLayerSkills, skillVars } from '../src/scaffold/skills'

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

describe('detectFeatureLayers', () => {
  const app = (pkg: object) => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-detect-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
    return dir
  }

  it('detects a feature from dependencies', () => {
    const dir = app({
      dependencies: { '@forinda/kickjs-queue': '^8', bullmq: '^5', ioredis: '^5' },
    })
    expect(detectFeatureLayers(dir)).toContain('feature-queue')
  })

  it('detects a feature from devDependencies', () => {
    const dir = app({
      dependencies: { '@forinda/kickjs-queue': '^8' },
      devDependencies: { bullmq: '^5', ioredis: '^5' },
    })
    expect(detectFeatureLayers(dir)).toContain('feature-queue')
  })

  it('needs every package the layer lists', () => {
    expect(detectFeatureLayers(app({ dependencies: { bullmq: '^5' } }))).not.toContain(
      'feature-queue',
    )
  })

  it('a layer without dependencies never counts', () => {
    const dir = app({ devDependencies: { '@forinda/kickjs-devtools': '^7' } })
    expect(detectFeatureLayers(dir)).not.toContain('feature-devtools')
  })

  it('no package.json: none', () => {
    expect(detectFeatureLayers(mkdtempSync(join(tmpdir(), 'kick-detect-')))).toEqual([])
  })
})

describe('kick g agents writes the detected layers’ skills', () => {
  it('a views app gets the views skills; another app does not', async () => {
    const withViews = mkdtempSync(join(tmpdir(), 'kick-agents-'))
    writeFileSync(
      join(withViews, 'package.json'),
      JSON.stringify({ name: 'v', dependencies: { '@forinda/kickjs-view': '^0.3.0' } }),
    )
    await generateAgentDocs({ outDir: withViews, only: 'skills', pm: 'pnpm' })
    expect(existsSync(join(withViews, '.agents/skills/views/SKILL.md'))).toBe(true)
    expect(existsSync(join(withViews, '.agents/skills/add-module/SKILL.md'))).toBe(true)

    const without = mkdtempSync(join(tmpdir(), 'kick-agents-'))
    writeFileSync(join(without, 'package.json'), JSON.stringify({ name: 'w' }))
    await generateAgentDocs({ outDir: without, only: 'skills', pm: 'pnpm' })
    expect(existsSync(join(without, '.agents/skills/views'))).toBe(false)
  })
})

describe('kick add writes the layer skills', () => {
  const appWith = (skillsDir: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-add-skills-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }))
    if (skillsDir) mkdirSync(join(dir, '.agents/skills/add-module'), { recursive: true })
    return dir
  }

  it('kick add views writes the views skills when .agents/skills exists', async () => {
    const dir = appWith(true)
    const written = await writeLayerSkills(dir, ['feature-views'], 'pnpm')
    expect(written.toSorted()).toEqual([
      '.agents/skills/views-forms/SKILL.md',
      '.agents/skills/views/SKILL.md',
    ])
    const skill = readFileSync(join(dir, '.agents/skills/views/SKILL.md'), 'utf8')
    expect(skill).toMatch(/^---\nname: kickjs-views\n/)
    expect(skill).toContain('pnpm exec kick check:views')
    // Only the layer's skills: the base ones are kick g agents' job.
    expect(existsSync(join(dir, '.agents/skills/add-module/SKILL.md'))).toBe(false)
  })

  it('no .agents/skills: no skills written', async () => {
    const dir = appWith(false)
    expect(await writeLayerSkills(dir, ['feature-views'], 'pnpm')).toEqual([])
    expect(existsSync(join(dir, '.agents'))).toBe(false)
  })

  it('kick add views keeps an edited skill', async () => {
    const dir = appWith(true)
    mkdirSync(join(dir, '.agents/skills/views'), { recursive: true })
    writeFileSync(join(dir, '.agents/skills/views/SKILL.md'), 'mine')
    expect(await writeLayerSkills(dir, ['feature-views'], 'pnpm')).toEqual([
      '.agents/skills/views-forms/SKILL.md',
    ])
    expect(readFileSync(join(dir, '.agents/skills/views/SKILL.md'), 'utf8')).toBe('mine')
  })
})
