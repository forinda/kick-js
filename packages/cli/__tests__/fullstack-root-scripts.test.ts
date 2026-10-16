/**
 * A fullstack root's own docs name only scripts the root has: its CLAUDE.md
 * quick reference and README are run from the workspace root, which has no
 * kick.config.ts, so every command there must be a root script.
 */
import { describe, expect, it } from 'vitest'
import { PACKAGE_MANAGERS, runScript } from '../src/config'
import { rootPackageJson, rootReadme } from '../src/generators/fullstack'
import { generateAgents, generateClaude } from '../src/generators/templates/project-docs'

describe.each(PACKAGE_MANAGERS)('fullstack root on %s', (pm) => {
  const scripts = Object.keys(JSON.parse(rootPackageJson('demo', pm, '1.0.0', undefined)).scripts)
  const docs = [
    generateClaude('demo', 'fullstack', pm),
    generateAgents('demo', 'fullstack', pm),
    rootReadme('demo', pm),
  ].join('\n')

  it('has a script for every root command its docs print', () => {
    const prefix = runScript(pm, '§').replace('§', '')
    const named = [...docs.matchAll(new RegExp(`${prefix.replace(/ /g, '\\s')}([\\w:]+)`, 'g'))]
      .map((m) => m[1]!)
      // Package-manager verbs, not scripts: `pnpm exec`, `pnpm link`, `yarn kick`, `yarn run`.
      .filter((name) => !['install', 'add', 'exec', 'dlx', 'link', 'run', 'kick'].includes(name))
    expect(named.length).toBeGreaterThan(3)
    expect(named.filter((name) => !scripts.includes(name))).toEqual([])
  })

  it('runs test, typecheck and format from the root', () => {
    expect(scripts).toEqual(expect.arrayContaining(['test', 'typecheck', 'format']))
  })

  it('type-checks web without running typegen there (no stray web/.kickjs)', () => {
    const { typecheck } = JSON.parse(rootPackageJson('demo', pm, '1.0.0', undefined)).scripts
    expect(typecheck).toContain('kick typecheck --cwd web --no-typegen')
  })
})

describe('fullstack web package', () => {
  it('ships an oxfmt config like the server', async () => {
    const { renderLayers } = await import('../src/scaffold/overlay')
    const { files } = renderLayers(['web-kick'])
    expect(JSON.parse(files.get('web/.oxfmtrc.json')!)).toMatchObject({
      semi: false,
      singleQuote: true,
    })
  })
})
