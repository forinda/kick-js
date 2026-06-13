import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, it, expect } from 'vitest'

import { PACKAGE_REGISTRY, planAddPackages } from '../src/commands/add'

const WORKSPACE_PACKAGES_DIR = resolve(__dirname, '../..')

/** name → package.json for every workspace package under packages/ */
function workspaceManifests(): Map<string, { name: string; private?: boolean }> {
  const out = new Map<string, { name: string; private?: boolean }>()
  for (const dir of readdirSync(WORKSPACE_PACKAGES_DIR)) {
    const p = join(WORKSPACE_PACKAGES_DIR, dir, 'package.json')
    if (!existsSync(p)) continue
    const manifest = JSON.parse(readFileSync(p, 'utf-8'))
    out.set(manifest.name, manifest)
  }
  return out
}

describe('PACKAGE_REGISTRY catalog health', () => {
  const manifests = workspaceManifests()

  it('covers auth and ai', () => {
    expect(PACKAGE_REGISTRY.auth?.pkg).toBe('@forinda/kickjs-auth')
    expect(PACKAGE_REGISTRY.ai?.pkg).toBe('@forinda/kickjs-ai')
  })

  it('marks drizzle and prisma as deprecated with a kickjs-db migration hint', () => {
    expect(PACKAGE_REGISTRY.drizzle?.deprecated).toContain('@forinda/kickjs-db')
    expect(PACKAGE_REGISTRY.prisma?.deprecated).toContain('@forinda/kickjs-db')
  })

  it('marks auth as deprecated with the BYO migration hint', () => {
    expect(PACKAGE_REGISTRY.auth?.deprecated).toContain('BYO')
  })

  it('every first-party entry points at an existing workspace package; non-deprecated ones are public', () => {
    for (const [name, entry] of Object.entries(PACKAGE_REGISTRY)) {
      if (!entry.pkg.startsWith('@forinda/')) continue
      const manifest = manifests.get(entry.pkg)
      expect(
        manifest,
        `registry entry '${name}' → ${entry.pkg} not found in workspace`,
      ).toBeDefined()
      // Deprecated entries (auth/prisma/drizzle) are frozen `private: true`:
      // they no longer cut new versions but remain installable from their last
      // npm release, so `kick add <name>` still works (with a deprecation
      // warning). Only non-deprecated entries must be published (non-private).
      if (entry.deprecated) continue
      expect(manifest?.private ?? false, `registry entry '${name}' → ${entry.pkg} is private`).toBe(
        false,
      )
    }
  })

  it('never offers the merged db-* dialect shims or internal support packages', () => {
    const offered = new Set(Object.values(PACKAGE_REGISTRY).map((e) => e.pkg))
    for (const shim of [
      '@forinda/kickjs-db-pg',
      '@forinda/kickjs-db-mysql',
      '@forinda/kickjs-db-sqlite',
      '@forinda/kickjs-cli-kit',
      '@forinda/kickjs-devtools-kit',
    ]) {
      expect(offered.has(shim), `${shim} should not be in the catalog`).toBe(false)
    }
  })
})

describe('planAddPackages', () => {
  it('resolves a known package with its peers', () => {
    const plan = planAddPackages(['ws'], false)
    expect(plan.prodDeps).toContain('@forinda/kickjs-ws')
    // @forinda/kickjs-ws is built on the `ws` package (WebSocketServer),
    // not socket.io — the catalog peer must match the actual dependency.
    expect(plan.prodDeps).toContain('ws')
    expect(plan.prodDeps).not.toContain('socket.io')
    expect(plan.unknown).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  it('auth still installs (with jsonwebtoken) but carries a deprecation warning', () => {
    const plan = planAddPackages(['auth'], false)
    expect(plan.prodDeps).toContain('@forinda/kickjs-auth')
    expect(plan.prodDeps).toContain('jsonwebtoken')
    expect(plan.warnings.length).toBe(1)
    expect(plan.warnings[0]).toContain('BYO')
  })

  it('collects unknown names without dropping known ones', () => {
    const plan = planAddPackages(['nope', 'swagger'], false)
    expect(plan.unknown).toEqual(['nope'])
    expect(plan.prodDeps).toContain('@forinda/kickjs-swagger')
  })

  it('warns when adding a deprecated package but still installs it', () => {
    const plan = planAddPackages(['prisma'], false)
    expect(plan.prodDeps).toContain('@forinda/kickjs-prisma')
    expect(plan.warnings.length).toBe(1)
    expect(plan.warnings[0]).toContain('prisma')
    expect(plan.warnings[0]).toContain('@forinda/kickjs-db')
  })

  it('honours the dev flag and per-entry dev defaults', () => {
    const devForced = planAddPackages(['swagger'], true)
    expect(devForced.devDeps).toContain('@forinda/kickjs-swagger')

    const devByDefault = planAddPackages(['testing'], false)
    expect(devByDefault.devDeps).toContain('@forinda/kickjs-testing')
  })
})
