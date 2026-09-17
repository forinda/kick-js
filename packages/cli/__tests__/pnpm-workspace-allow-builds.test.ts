/**
 * pnpm 10+ blocks dependency install scripts it hasn't been told about, and a
 * non-interactive install can't ask: it writes a placeholder into
 * pnpm-workspace.yaml and every later `pnpm exec` / script fails with
 * ERR_PNPM_IGNORED_BUILDS. Scaffolds approve the template's build tools up front.
 */
import { describe, expect, it } from 'vitest'

import { generatePnpmWorkspace } from '../src/generators/templates/project-config'

describe('generatePnpmWorkspace', () => {
  it('approves @swc/core and esbuild for a single project, with no packages list', () => {
    expect(generatePnpmWorkspace()).toBe("allowBuilds:\n  '@swc/core': true\n  esbuild: true\n")
  })

  it('lists the members for a workspace root', () => {
    expect(generatePnpmWorkspace(['server', 'web'])).toBe(
      "packages:\n  - server\n  - web\n\nallowBuilds:\n  '@swc/core': true\n  esbuild: true\n",
    )
  })
})
