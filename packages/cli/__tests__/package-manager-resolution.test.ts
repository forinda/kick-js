import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolvePackageManager, resolvePackageManagerWithSource } from '../src/commands/add'

describe('resolvePackageManager', () => {
  let fixture: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    fixture = mkdtempSync(join(tmpdir(), 'kick-pm-'))
    process.chdir(fixture)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(fixture, { recursive: true, force: true })
  })

  it('returns the --pm flag when provided and valid', async () => {
    writeFileSync(join(fixture, 'pnpm-lock.yaml'), '')
    expect(await resolvePackageManager('yarn')).toBe('yarn')
  })

  it('ignores unknown --pm values and falls through', async () => {
    writeFileSync(join(fixture, 'pnpm-lock.yaml'), '')
    expect(await resolvePackageManager('rush')).toBe('pnpm')
  })

  it('honors packageManager from kick.config.json', async () => {
    writeFileSync(
      join(fixture, 'kick.config.json'),
      JSON.stringify({ packageManager: 'pnpm' }),
    )
    writeFileSync(join(fixture, 'yarn.lock'), '')
    expect(await resolvePackageManager(undefined)).toBe('pnpm')
  })

  it('falls back to package.json packageManager (corepack) when no config', async () => {
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({ name: 't', packageManager: 'yarn@4.0.0' }),
    )
    expect(await resolvePackageManager(undefined)).toBe('yarn')
  })

  it('ignores invalid corepack packageManager values', async () => {
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({ name: 't', packageManager: 'rush@5.0.0' }),
    )
    writeFileSync(join(fixture, 'pnpm-lock.yaml'), '')
    expect(await resolvePackageManager(undefined)).toBe('pnpm')
  })

  it('detects pnpm from pnpm-lock.yaml', async () => {
    writeFileSync(join(fixture, 'pnpm-lock.yaml'), '')
    expect(await resolvePackageManager(undefined)).toBe('pnpm')
  })

  it('detects yarn from yarn.lock', async () => {
    writeFileSync(join(fixture, 'yarn.lock'), '')
    expect(await resolvePackageManager(undefined)).toBe('yarn')
  })

  it('detects bun from bun.lockb', async () => {
    writeFileSync(join(fixture, 'bun.lockb'), '')
    expect(await resolvePackageManager(undefined)).toBe('bun')
  })

  it('defaults to npm when no signal is present', async () => {
    expect(await resolvePackageManager(undefined)).toBe('npm')
  })

  it('config beats package.json packageManager', async () => {
    writeFileSync(
      join(fixture, 'kick.config.json'),
      JSON.stringify({ packageManager: 'pnpm' }),
    )
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({ name: 't', packageManager: 'yarn@4.0.0' }),
    )
    expect(await resolvePackageManager(undefined)).toBe('pnpm')
  })

  it('--pm flag beats kick.config', async () => {
    writeFileSync(
      join(fixture, 'kick.config.json'),
      JSON.stringify({ packageManager: 'pnpm' }),
    )
    expect(await resolvePackageManager('yarn')).toBe('yarn')
  })

  it('climbs to a parent package.json packageManager field (workspace sub-package)', async () => {
    // Sub-package has no packageManager field; root does. Mimics
    // examples/<app> sitting under a corepack-pinned monorepo root.
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({ name: 'root', packageManager: 'pnpm@10.0.0' }),
    )
    const sub = join(fixture, 'apps', 'sub')
    mkdirSync(sub, { recursive: true })
    writeFileSync(
      join(sub, 'package.json'),
      JSON.stringify({ name: 'sub', dependencies: { foo: 'workspace:*' } }),
    )
    process.chdir(sub)
    expect(await resolvePackageManager(undefined)).toBe('pnpm')
  })

  it('climbs to a parent lockfile (workspace sub-package, no packageManager field)', async () => {
    // No packageManager field anywhere; lockfile only at root.
    writeFileSync(join(fixture, 'pnpm-lock.yaml'), '')
    const sub = join(fixture, 'apps', 'sub')
    mkdirSync(sub, { recursive: true })
    writeFileSync(
      join(sub, 'package.json'),
      JSON.stringify({ name: 'sub' }),
    )
    process.chdir(sub)
    expect(await resolvePackageManager(undefined)).toBe('pnpm')
  })

  it('reports the resolution source via resolvePackageManagerWithSource', async () => {
    writeFileSync(
      join(fixture, 'kick.config.json'),
      JSON.stringify({ packageManager: 'pnpm' }),
    )
    expect(await resolvePackageManagerWithSource(undefined)).toEqual({
      pm: 'pnpm',
      source: 'config',
    })
    expect(await resolvePackageManagerWithSource('yarn')).toEqual({
      pm: 'yarn',
      source: 'flag',
    })
  })
})
