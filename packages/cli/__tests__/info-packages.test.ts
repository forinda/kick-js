import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { resolveInstalledKickPackages } from '../src/commands/info'

let project: string

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'kick-info-'))
})

afterEach(() => {
  rmSync(project, { recursive: true, force: true })
})

function writeManifest(dir: string, manifest: object): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
}

describe('resolveInstalledKickPackages', () => {
  it('lists @forinda/kickjs* deps with installed versions from node_modules', () => {
    writeManifest(project, {
      name: 'app',
      dependencies: { '@forinda/kickjs': '^5.16.0', express: '^5.1.0' },
      devDependencies: { '@forinda/kickjs-cli': '^6.0.1' },
    })
    writeManifest(join(project, 'node_modules', '@forinda', 'kickjs'), {
      name: '@forinda/kickjs',
      version: '5.16.0',
    })

    const pkgs = resolveInstalledKickPackages(project)
    expect(pkgs.map((p) => p.name)).toEqual(['@forinda/kickjs', '@forinda/kickjs-cli'])

    const kickjs = pkgs.find((p) => p.name === '@forinda/kickjs')!
    expect(kickjs.installed).toBe('5.16.0')
    expect(kickjs.declared).toBe('^5.16.0')

    // cli not present in node_modules — falls back to declared range only
    const cli = pkgs.find((p) => p.name === '@forinda/kickjs-cli')!
    expect(cli.installed).toBeNull()
    expect(cli.declared).toBe('^6.0.1')
  })

  it('flags deprecated packages from the kick add catalog', () => {
    writeManifest(project, {
      name: 'app',
      dependencies: {
        '@forinda/kickjs-prisma': '^6.0.0',
        '@forinda/kickjs-db': '^6.1.1',
      },
    })

    const pkgs = resolveInstalledKickPackages(project)
    expect(pkgs.find((p) => p.name === '@forinda/kickjs-prisma')?.deprecated).toBe(true)
    expect(pkgs.find((p) => p.name === '@forinda/kickjs-db')?.deprecated).toBe(false)
  })

  it('returns empty outside a project', () => {
    expect(resolveInstalledKickPackages(join(project, 'does-not-exist'))).toEqual([])
  })

  it('ignores non-kickjs scoped packages', () => {
    writeManifest(project, {
      name: 'app',
      dependencies: { '@forinda/other-lib': '^1.0.0', zod: '^4.0.0' },
    })
    expect(resolveInstalledKickPackages(project)).toEqual([])
  })
})
