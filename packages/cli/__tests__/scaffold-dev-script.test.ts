/**
 * Drift guard: the scaffolded `dev` script must go through `kick dev`,
 * never bare `vite`. The typegen-on-save watcher (and the --typecheck
 * worker) live ONLY in `kick dev` — a bare `vite` script gives working
 * HMR with silently frozen `.kickjs/types`, the exact DX failure where
 * adding a controller path requires a manual `kick typegen`.
 */
import { describe, it, expect } from 'vitest'

import { generatePackageJson } from '../src/generators/templates/project-config'

/**
 * The shape `resolveSiblingVersions()` returns: siblings resolved by name,
 * third-party packages resolved too — the templates read every range from
 * this map rather than carrying pins.
 */
const versions = () =>
  new Proxy(
    {
      '@forinda/kickjs': '^5.16.0',
      '@forinda/kickjs-schema': '^0.1.2',
      '@forinda/kickjs-cli': '^6.0.1',
      '@forinda/kickjs-testing': '^7.0.0',
      '@forinda/kickjs-vite': '^6.0.1',
    } as Record<string, string>,
    { get: (target, key: string) => target[key] ?? '^1.0.0' },
  )

describe('scaffolded package.json scripts', () => {
  it('dev runs kick dev (typegen watcher), not bare vite', () => {
    const fixture = versions()
    const pkg = JSON.parse(generatePackageJson('demo-app', 'minimal', fixture))
    expect(pkg.scripts.dev).toBe('kick dev')
    expect(pkg.scripts.build).toBe('kick build')
  })

  it('ships the four everyday scripts plus the two deploy targets, and no script it cannot run', () => {
    const pkg = JSON.parse(generatePackageJson('demo-app', 'minimal', versions()))

    // The deploy pair runs `kick build:netlify` / `kick build:vercel`, both
    // built into the CLI that is already a devDependency.
    expect(Object.keys(pkg.scripts).toSorted()).toEqual([
      'build',
      'build:netlify',
      'build:vercel',
      'dev',
      'start',
      'test',
    ])

    // Every command a script invokes has to be installed. `lint: 'eslint src/'`
    // shipped for a long time with eslint in no dependency list, so `lint`
    // failed with "command not found" in every generated project.
    const devDeps = Object.keys(pkg.devDependencies)
    expect(devDeps).toContain('vitest')
    expect(devDeps).not.toContain('eslint')
    expect(devDeps).not.toContain('prettier')
  })

  it('formats with the tool the framework itself uses', () => {
    const pkg = JSON.parse(generatePackageJson('demo-app', 'minimal', versions()))

    // A scaffold arriving with prettier, from a repo formatted by oxfmt, makes
    // the generated project disagree with the framework it came from.
    expect(pkg.devDependencies).toHaveProperty('oxfmt')
    expect(pkg.devDependencies).not.toHaveProperty('prettier')
  })
})
