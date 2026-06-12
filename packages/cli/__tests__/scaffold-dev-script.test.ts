/**
 * Drift guard: the scaffolded `dev` script must go through `kick dev`,
 * never bare `vite`. The typegen-on-save watcher (and the --typecheck
 * worker) live ONLY in `kick dev` — a bare `vite` script gives working
 * HMR with silently frozen `.kickjs/types`, the exact DX failure where
 * adding a controller path requires a manual `kick typegen`.
 */
import { describe, it, expect } from 'vitest'

import { generatePackageJson } from '../src/generators/templates/project-config'

describe('scaffolded package.json scripts', () => {
  it('dev runs kick dev (typegen watcher), not bare vite', () => {
    const versions = {
      '@forinda/kickjs': '^5.16.0',
      '@forinda/kickjs-schema': '^0.1.2',
      '@forinda/kickjs-cli': '^6.0.1',
      '@forinda/kickjs-vite': '^6.0.1',
    }
    const pkg = JSON.parse(generatePackageJson('demo-app', 'minimal', versions))
    expect(pkg.scripts.dev).toBe('kick dev')
    expect(pkg.scripts['dev:debug']).toBe('kick dev:debug')
    expect(pkg.scripts.build).toBe('kick build')
    expect(pkg.scripts.typegen).toBe('kick typegen')
  })
})
