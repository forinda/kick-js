/**
 * pnpm 10+ blocks dependency install scripts it hasn't been told about, and a
 * non-interactive install can't ask: it writes a placeholder into
 * pnpm-workspace.yaml and every later `pnpm exec` / script fails with
 * ERR_PNPM_IGNORED_BUILDS. Scaffolds approve the template's build tools up front.
 */
import { describe, expect, it } from 'vitest'

import { buildsFor } from '../src/commands/add'
import { generatePnpmWorkspace, setAllowBuilds } from '../src/generators/templates/project-config'

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

describe('setAllowBuilds', () => {
  it('fills the placeholder pnpm writes and keeps answered keys and other settings', () => {
    const yaml = [
      'packages:',
      '  - server',
      '',
      'allowBuilds:',
      "  '@scarf/scarf': set this to true or false",
      "  '@swc/core': false",
      'minimumReleaseAgeExclude:',
      "  - '@forinda/kickjs@8.6.0'",
      '',
    ].join('\n')
    expect(setAllowBuilds(yaml, { '@scarf/scarf': true, '@swc/core': true, esbuild: true })).toBe(
      [
        'packages:',
        '  - server',
        '',
        'allowBuilds:',
        "  '@scarf/scarf': true",
        "  '@swc/core': false",
        '  esbuild: true',
        'minimumReleaseAgeExclude:',
        "  - '@forinda/kickjs@8.6.0'",
        '',
      ].join('\n'),
    )
  })

  it('adds an allowBuilds block to a file without one, or to an empty file', () => {
    expect(setAllowBuilds('packages:\n  - web\n', { '@scarf/scarf': true })).toBe(
      "packages:\n  - web\n\nallowBuilds:\n  '@scarf/scarf': true\n",
    )
    expect(setAllowBuilds('', { '@scarf/scarf': true })).toBe(
      "allowBuilds:\n  '@scarf/scarf': true\n",
    )
  })
})

describe('buildsFor', () => {
  it("approves swagger-ui-dist's @scarf/scarf when swagger is added", () => {
    expect(buildsFor(['swagger', 'nope'])).toEqual({ '@scarf/scarf': true })
    expect(generatePnpmWorkspace(undefined, buildsFor(['swagger']))).toContain(
      "'@scarf/scarf': true",
    )
  })
})
