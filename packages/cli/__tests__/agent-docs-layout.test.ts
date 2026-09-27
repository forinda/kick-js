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
    const skills = generateKickJsSkillFiles('demo', 'rest', 'pnpm')
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
    const pnpmSkills = generateKickJsSkillFiles('demo', 'rest', 'pnpm')
    const yarnSkills = generateKickJsSkillFiles('demo', 'rest', 'yarn')

    const addModulePnpm = pnpmSkills.find((s) => s.slug === 'add-module')!
    const addModuleYarn = yarnSkills.find((s) => s.slug === 'add-module')!

    // `run test`, not `run typecheck`: typechecking goes through
    // `kick typecheck` now, which is the same command under every manager —
    // that is the point of routing it through the CLI. `test` is still a
    // package script, so it remains the thing that must be interpolated.
    expect(addModulePnpm.content).toMatch(/pnpm run test/)
    expect(addModuleYarn.content).toMatch(/yarn run test/)
    // The pnpm copy should NOT mention yarn and vice versa
    expect(addModulePnpm.content).not.toMatch(/yarn run/)
    expect(addModuleYarn.content).not.toMatch(/pnpm run/)
  })
})

describe('the deploy skill', () => {
  const skill = () =>
    generateKickJsSkillFiles('demo', 'minimal', 'pnpm', 'define').find((f) => f.slug === 'deploy')!

  it('is generated with the shared frontmatter shape', () => {
    expect(skill()).toBeDefined()
    expect(skill().content).toMatch(/^---\nname:\s+kickjs-deploy\n/)
  })

  it('carries the three failures that cost real deploys', () => {
    const body = skill().content
    // Wrangler's esbuild emits no decorator metadata, so DI dies at startup.
    expect(body).toContain('nodejs_compat')
    expect(body).toContain('createFetchHandler')
    // preferStatic makes the SPA rewrite shadow the Netlify function.
    expect(body).toContain('preferStatic')
    expect(body).toContain('build:netlify')
    expect(body).toContain('build:vercel')
  })
})

describe('the factory skills', () => {
  const skills = () => generateKickJsSkillFiles('demo', 'minimal', 'pnpm', 'define')
  const bySlug = (slug: string) => skills().find((f) => f.slug === slug)!

  it('teaches every define* factory an app author reaches for', () => {
    // One skill per factory, so an agent asked for any of them has steps to
    // follow instead of inventing a middleware.
    const covered = skills()
      .map((f) => f.content)
      .join('\n')
    for (const factory of [
      'defineModule',
      'defineAdapter',
      'definePlugin',
      'defineContextDecorator',
      'defineRouteFlag',
      'defineCliPlugin',
    ]) {
      expect(covered, `${factory} should be taught by some skill`).toContain(factory)
    }
  })

  it('keeps the two plugin kinds apart', () => {
    // defineCliPlugin extends the CLI; definePlugin hooks the running app.
    const body = bySlug('cli-plugin').content
    expect(body).toContain('@forinda/kickjs-cli')
    expect(body).toContain('definePlugin')
  })

  it('spells flag removal as .off, never a falsy value', () => {
    const body = bySlug('route-flags').content
    expect(body).toContain('.off')
    expect(body).toContain('@Public(false)')
  })
})

describe('the route-flags skill mount points', () => {
  const body = () =>
    generateKickJsSkillFiles('demo', 'minimal', 'pnpm', 'define').find(
      (f) => f.slug === 'route-flags',
    )!.content

  it('says where each consumer mounts, not just that it exists', () => {
    // Knowing a guard reads ctx.route is useless without knowing a guard is
    // mounted with @Middleware() and global middleware runs before matching.
    expect(body()).toContain('@Middleware(fn)')
    expect(body()).toContain('bootstrap({ middlewares:')
    expect(body()).toContain('AppAdapter.middleware()')
    expect(body()).toContain('bootstrap({ contributors })')
  })

  it('carries the five contributor precedence levels in order', () => {
    expect(body()).toContain(
      'method > class > module `contributors()` > adapter `contributors()` > `bootstrap({ contributors })`',
    )
  })

  it('warns that ctx.route is absent before route matching', () => {
    expect(body()).toMatch(/ctx\.route.*undefined/)
  })
})
