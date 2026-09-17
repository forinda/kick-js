/**
 * Package managers block dependency install scripts nobody approved: pnpm 10+
 * fails (ERR_PNPM_IGNORED_BUILDS on every later `pnpm exec`), npm 11.19+ and
 * bun skip them. Scaffolds and `kick add` record the answers up front.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { TEMPLATE_BUILDS, approveInstallScripts, buildsFor } from '../src/commands/add'
import { setAllowBuilds } from '../src/generators/templates/project-config'

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
        'onlyBuiltDependencies:',
        "  - '@scarf/scarf'",
        '  - esbuild',
        '',
        'ignoredBuiltDependencies:',
        "  - '@swc/core'",
        '',
      ].join('\n'),
    )
  })

  it('finds entries after a blank line inside a block', () => {
    const yaml = [
      'allowBuilds:',
      '  esbuild: true',
      '',
      "  '@swc/core': false",
      'onlyBuiltDependencies:',
      '  - esbuild',
      '',
      "  - '@scarf/scarf'",
      'packages:',
      '  - web',
      '',
    ].join('\n')
    expect(setAllowBuilds(yaml, { '@swc/core': true, '@scarf/scarf': true })).toBe(
      [
        'allowBuilds:',
        '  esbuild: true',
        '',
        "  '@swc/core': false",
        "  '@scarf/scarf': true",
        'onlyBuiltDependencies:',
        '  - esbuild',
        '',
        "  - '@scarf/scarf'",
        'packages:',
        '  - web',
        '',
        'ignoredBuiltDependencies:',
        "  - '@swc/core'",
        '',
      ].join('\n'),
    )
  })

  it('writes both formats to a file without them, or to an empty file', () => {
    expect(setAllowBuilds('packages:\n  - web\n', { '@scarf/scarf': true })).toBe(
      "packages:\n  - web\n\nallowBuilds:\n  '@scarf/scarf': true\n\nonlyBuiltDependencies:\n  - '@scarf/scarf'\n",
    )
    expect(setAllowBuilds('', { esbuild: true })).toBe(
      'allowBuilds:\n  esbuild: true\n\nonlyBuiltDependencies:\n  - esbuild\n',
    )
  })
})

describe('buildsFor', () => {
  it("approves swagger-ui-dist's @scarf/scarf when swagger is added", () => {
    expect(buildsFor(['swagger', 'nope'])).toEqual({ '@scarf/scarf': true })
  })
})

describe('approveInstallScripts', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })
  const project = (pkg: Record<string, unknown> = { name: 'app' }) => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-scripts-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
    return dir
  }
  const pkgOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))

  it('pnpm: writes both approval formats to pnpm-workspace.yaml', () => {
    const dir = project()
    approveInstallScripts('pnpm', dir, TEMPLATE_BUILDS)
    expect(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf-8')).toBe(
      "allowBuilds:\n  '@swc/core': true\n  esbuild: true\n\nonlyBuiltDependencies:\n  - '@swc/core'\n  - esbuild\n",
    )
  })

  it('npm: writes allowScripts, keeping answered and version-pinned keys', () => {
    const dir = project({ name: 'app', allowScripts: { 'esbuild@0.28.2': false } })
    approveInstallScripts('npm', dir, { ...TEMPLATE_BUILDS, '@scarf/scarf': true })
    expect(pkgOf(dir).allowScripts).toEqual({
      'esbuild@0.28.2': false,
      '@swc/core': true,
      '@scarf/scarf': true,
    })
  })

  it('bun: adds approvals to trustedDependencies once', () => {
    const dir = project({ name: 'app', trustedDependencies: ['esbuild'] })
    approveInstallScripts('bun', dir, TEMPLATE_BUILDS)
    expect(approveInstallScripts('bun', dir, TEMPLATE_BUILDS)).toBeUndefined()
    expect(pkgOf(dir).trustedDependencies).toEqual(['esbuild', '@swc/core'])
  })

  it('yarn: writes nothing', () => {
    const dir = project()
    expect(approveInstallScripts('yarn', dir, TEMPLATE_BUILDS)).toBeUndefined()
    expect(pkgOf(dir)).toEqual({ name: 'app' })
  })
})
