import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateAgentDocs } from '../src/generators/agent-docs'
import { generateKickJsSkillFiles } from '../src/generators/templates/project-docs'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kick-agent-docs-'))
  // Minimal package.json so the generator can detect the project name + pm
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'demo-project', packageManager: 'pnpm@10.0.0' }, null, 2),
  )
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('kick g agents → .agents/ subfolder layout', () => {
  it('emits CLAUDE.md at the project root', async () => {
    const files = await generateAgentDocs({ outDir: dir, only: 'claude', force: true })
    expect(files.some((f) => f.endsWith('CLAUDE.md'))).toBe(true)
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true)
    // CLAUDE.md is NOT under .agents/
    expect(existsSync(join(dir, '.agents', 'CLAUDE.md'))).toBe(false)
  })

  it('emits AGENTS.md under .agents/, NOT the project root', async () => {
    await generateAgentDocs({ outDir: dir, only: 'agents', force: true })
    expect(existsSync(join(dir, '.agents', 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false)
  })

  it('emits GEMINI.md and COPILOT.md under .agents/', async () => {
    await generateAgentDocs({ outDir: dir, only: 'gemini', force: true })
    await generateAgentDocs({ outDir: dir, only: 'copilot', force: true })
    expect(existsSync(join(dir, '.agents', 'GEMINI.md'))).toBe(true)
    expect(existsSync(join(dir, '.agents', 'COPILOT.md'))).toBe(true)
  })

  it('emits one SKILL.md per skill under .agents/skills/<slug>/', async () => {
    const files = await generateAgentDocs({ outDir: dir, only: 'skills', force: true })
    // generateAgentDocs returns absolute file paths
    const skillFiles = files.filter(
      (f) => f.includes(join('.agents', 'skills')) && f.endsWith('SKILL.md'),
    )
    expect(skillFiles.length).toBeGreaterThanOrEqual(13)

    // Verify every emitted SKILL.md has YAML frontmatter with name + description
    for (const filePath of skillFiles) {
      const content = await readFile(filePath, 'utf-8')
      expect(content.startsWith('---\n')).toBe(true)
      expect(content).toMatch(/^name:\s+kickjs-/m)
      expect(content).toMatch(/^description:\s+/m)
      // Frontmatter is followed by the closing `---` and then the body.
      expect(content.split('---\n').length).toBeGreaterThanOrEqual(3)
    }
  })

  it('--only all emits CLAUDE.md at root + everything else under .agents/', async () => {
    const files = await generateAgentDocs({ outDir: dir, only: 'all', force: true })
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(dir, '.agents', 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(dir, '.agents', 'GEMINI.md'))).toBe(true)
    expect(existsSync(join(dir, '.agents', 'COPILOT.md'))).toBe(true)
    // At least one skill landed.
    const skillFiles = files.filter(
      (f) => f.includes(join('.agents', 'skills')) && f.endsWith('SKILL.md'),
    )
    expect(skillFiles.length).toBeGreaterThan(0)
  })

  it('leaves a pre-existing root-level AGENTS.md untouched (no auto-migration)', async () => {
    // Adopter has an old AGENTS.md from before the .agents/ restructure.
    const legacyContent = '# legacy AGENTS.md at the root\n'
    await writeFile(join(dir, 'AGENTS.md'), legacyContent)

    await generateAgentDocs({ outDir: dir, only: 'agents', force: true })

    // Old root file untouched.
    expect(await readFile(join(dir, 'AGENTS.md'), 'utf-8')).toBe(legacyContent)
    // New layout emitted alongside.
    expect(existsSync(join(dir, '.agents', 'AGENTS.md'))).toBe(true)
  })

  it('CLAUDE.md points at .agents/ paths', async () => {
    await generateAgentDocs({ outDir: dir, only: 'claude', force: true })
    const claude = await readFile(join(dir, 'CLAUDE.md'), 'utf-8')
    // Pointer paths updated post-restructure.
    expect(claude).toMatch(/\.agents\/AGENTS\.md/)
    expect(claude).toMatch(/\.agents\/skills\//)
    // Old flat-file path shouldn't reappear in the pointer.
    expect(claude).not.toMatch(/\bkickjs-skills\.md\b/)
  })
})

describe('generateKickJsSkillFiles — direct contract', () => {
  it('returns at least 9 skills, each with valid frontmatter', () => {
    const skills = generateKickJsSkillFiles('demo', 'ddd', 'pnpm')
    expect(skills.length).toBeGreaterThanOrEqual(9)

    for (const { slug, content } of skills) {
      expect(slug).toMatch(/^[a-z][a-z0-9-]*$/) // kebab-case
      expect(content.startsWith('---\n')).toBe(true)
      // Frontmatter has both required keys
      const firstBlock = content.split('---\n')[1] ?? ''
      expect(firstBlock).toMatch(/name:\s+kickjs-/)
      expect(firstBlock).toMatch(/description:\s+/)
    }
  })

  it('interpolates the package manager into skill bodies that reference it', () => {
    const pnpmSkills = generateKickJsSkillFiles('demo', 'ddd', 'pnpm')
    const yarnSkills = generateKickJsSkillFiles('demo', 'ddd', 'yarn')

    const addModulePnpm = pnpmSkills.find((s) => s.slug === 'add-module')!
    const addModuleYarn = yarnSkills.find((s) => s.slug === 'add-module')!

    expect(addModulePnpm.content).toMatch(/pnpm run typecheck/)
    expect(addModuleYarn.content).toMatch(/yarn run typecheck/)
    // The pnpm copy should NOT mention yarn and vice versa
    expect(addModulePnpm.content).not.toMatch(/yarn run/)
    expect(addModuleYarn.content).not.toMatch(/pnpm run/)
  })
})
