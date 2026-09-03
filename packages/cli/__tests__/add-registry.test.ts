import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, it, expect } from 'vitest'

import {
  PACKAGE_REGISTRY,
  planAddPackages,
  UPLOAD_DRIVERS,
  ENGINE_PEERS,
  detectRuntimeFromDepsDetailed,
  AVAILABLE_ADD_PACKAGES,
} from '../src/commands/add'

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

  it('covers ai', () => {
    expect(PACKAGE_REGISTRY.ai?.pkg).toBe('@forinda/kickjs-ai')
  })

  it('no longer offers auth, drizzle or prisma', () => {
    expect(PACKAGE_REGISTRY.auth).toBeUndefined()
    expect(PACKAGE_REGISTRY.drizzle).toBeUndefined()
    expect(PACKAGE_REGISTRY.prisma).toBeUndefined()
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

  it('the post-scaffold "Available:" list excludes deprecated and core packages', () => {
    const names = AVAILABLE_ADD_PACKAGES.split(',').map((s) => s.trim())
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const entry = PACKAGE_REGISTRY[name]
      expect(entry, `'${name}' is not a known registry package`).toBeDefined()
      expect(entry?.deprecated, `'${name}' is deprecated — must not be advertised`).toBeUndefined()
      expect(entry?.core, `'${name}' is core — already installed, don't advertise`).toBeFalsy()
    }
    expect(names).not.toContain('auth')
    expect(names).not.toContain('drizzle')
    expect(names).not.toContain('prisma')
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

  it('no longer installs anything for auth', () => {
    const plan = planAddPackages(['auth'], false)
    expect(plan.prodDeps).not.toContain('@forinda/kickjs-auth')
    expect(plan.prodDeps).not.toContain('jsonwebtoken')
    expect(plan.unknown).toEqual(['auth'])
  })

  it('installs the engine peers for the project runtime, not always express', () => {
    // The engine is chosen at `bootstrap({ runtime })`, so a Fastify project
    // getting `express` from `kick add kickjs` was simply wrong.
    expect(planAddPackages(['kickjs'], false, 'express').prodDeps).toContain('express')

    const fastify = planAddPackages(['kickjs'], false, 'fastify').prodDeps
    expect(fastify).toContain('fastify')
    expect(fastify).toContain('@fastify/middie')
    expect(fastify).not.toContain('express')

    const h3 = planAddPackages(['kickjs'], false, 'h3').prodDeps
    expect(h3).toContain('h3')
    expect(h3).not.toContain('express')
  })

  it('matches what `kick new` scaffolds for each engine', () => {
    // Drift here means `kick add` and `kick new` disagree about what a project
    // needs — the failure mode is a missing peer at boot.
    expect([...ENGINE_PEERS.express]).toEqual(['express'])
    expect([...ENGINE_PEERS.fastify]).toEqual(['fastify', '@fastify/middie', 'serve-static'])
    expect([...ENGINE_PEERS.h3]).toEqual(['h3', 'serve-static'])
  })

  it('prefers a prod engine dep over a dev one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-engine-'))
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { express: '^5' }, devDependencies: { fastify: '^5' } }),
    )
    // Fastify in devDependencies (a benchmark, a comparison test) must not
    // decide which engine the app deploys on.
    const detected = detectRuntimeFromDepsDetailed(dir)
    expect(detected.runtime).toBe('express')
    expect(detected.ambiguous).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('flags genuine ambiguity instead of picking by precedence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-engine-'))
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { fastify: '^5', h3: '^1' } }),
    )
    const detected = detectRuntimeFromDepsDetailed(dir)
    expect(detected.ambiguous).toBe(true)
    expect(detected.candidates).toEqual(['fastify', 'h3'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('is unambiguous with a single engine', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-engine-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { h3: '^1' } }))
    const detected = detectRuntimeFromDepsDetailed(dir)
    expect(detected).toMatchObject({ runtime: 'h3', ambiguous: false })
    rmSync(dir, { recursive: true, force: true })
  })

  it('names the engine in a notice so the install is explainable', () => {
    const plan = planAddPackages(['kickjs'], false, 'h3')
    expect(plan.notices.join(' ')).toContain('h3')
  })

  it('collects unknown names without dropping known ones', () => {
    const plan = planAddPackages(['nope', 'swagger'], false)
    expect(plan.unknown).toEqual(['nope'])
    expect(plan.prodDeps).toContain('@forinda/kickjs-swagger')
  })

  it('no longer installs anything for prisma', () => {
    const plan = planAddPackages(['prisma'], false)
    expect(plan.prodDeps).not.toContain('@forinda/kickjs-prisma')
    expect(plan.unknown).toEqual(['prisma'])
  })

  it('honours the dev flag and per-entry dev defaults', () => {
    const devForced = planAddPackages(['swagger'], true)
    expect(devForced.devDeps).toContain('@forinda/kickjs-swagger')

    const devByDefault = planAddPackages(['testing'], false)
    expect(devByDefault.devDeps).toContain('@forinda/kickjs-testing')
  })

  describe('upload — runtime-aware multipart driver', () => {
    it('installs multer (+ @types/multer dev) for the express runtime', () => {
      const plan = planAddPackages(['upload'], false, 'express')
      expect(plan.prodDeps).toContain('multer')
      expect(plan.devDeps).toContain('@types/multer')
      expect(plan.unknown).toEqual([])
      expect(plan.notices.some((n) => n.includes('multer'))).toBe(true)
    })

    it('installs @fastify/multipart for the fastify runtime', () => {
      const plan = planAddPackages(['upload'], false, 'fastify')
      expect(plan.prodDeps).toContain('@fastify/multipart')
      expect(plan.prodDeps).not.toContain('multer')
    })

    it('installs no driver for h3 (built-in multipart) but still notes it', () => {
      const plan = planAddPackages(['upload'], false, 'h3')
      expect(plan.prodDeps).toEqual([])
      expect(plan.devDeps).toEqual([])
      expect(plan.notices.some((n) => n.includes('h3'))).toBe(true)
    })

    it('defaults to the express driver when no runtime is passed', () => {
      const plan = planAddPackages(['upload'], false)
      expect(plan.prodDeps).toContain('multer')
    })

    it('never treats upload as an unknown package', () => {
      for (const rt of Object.keys(UPLOAD_DRIVERS) as Array<keyof typeof UPLOAD_DRIVERS>) {
        expect(planAddPackages(['upload'], false, rt).unknown).toEqual([])
      }
    })
  })
})
