/**
 * Drift guard for the `@` path alias.
 *
 * A `vitest.config.ts` OVERRIDES `vite.config.ts` entirely — vitest does not
 * merge them, and it never reads tsconfig `paths`. When the vitest config
 * declared its own settings, the alias lived in three files and an `@/…`
 * import could type-check, build, and run in dev while failing only under
 * test with `Cannot find package '@/…'`.
 *
 * The fix is to merge rather than restate, so these assert single-sourcing:
 * the alias is defined once in the vite config, and the vitest config pulls
 * that config in.
 */
import { describe, it, expect } from 'vitest'

import {
  generateViteConfig,
  generateVitestConfig,
  generateTsConfig,
} from '../src/generators/templates/project-config'

describe('@ alias is single-sourced across the scaffold', () => {
  it('defines the alias in the vite config and mirrors it in tsconfig paths', () => {
    expect(generateViteConfig()).toContain("'@': fileURLToPath(new URL('./src', import.meta.url))")
    expect(JSON.parse(generateTsConfig()).compilerOptions.paths['@/*']).toEqual(['./src/*'])
  })

  it('has the vitest config merge the vite config rather than restate it', () => {
    const cfg = generateVitestConfig()
    expect(cfg).toContain('mergeConfig')
    // The extension is required: without it Vite's native config loader warns
    // on every test run.
    expect(cfg).toContain("import viteConfig from './vite.config.ts'")
    // A second alias declaration here is the drift this guards against.
    expect(cfg).not.toContain("'@':")
  })

  it('keeps __dirname out of the vite config', () => {
    // `__dirname` does not exist under Vite's `configLoader: 'native'`, which
    // is slated to become the default. Once vitest loads this config through
    // the merge, that warning surfaces on every test run.
    expect(generateViteConfig()).not.toContain('__dirname')
  })
})
