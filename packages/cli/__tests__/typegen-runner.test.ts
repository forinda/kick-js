import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runTypegen } from '../src/typegen/runner'
import type { TypegenPlugin } from '../src/typegen/plugin'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kick-typegen-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const plugin: TypegenPlugin = {
  id: 'test/echo',
  inputs: [],
  async generate() {
    return 'export type Echo = "hello"'
  },
}

describe('runTypegen', () => {
  it('writes the file with banner', async () => {
    const r = await runTypegen({ cwd: dir, config: {} as never, plugins: [plugin] })
    expect(r[0].status).toBe('written')
    const out = await readFile(r[0].outFile!, 'utf8')
    expect(out).toContain('AUTO-GENERATED')
    expect(out).toContain('Plugin: test/echo')
    expect(out).toContain('Echo = "hello"')
  })

  it('marks unchanged on second run', async () => {
    await runTypegen({ cwd: dir, config: {} as never, plugins: [plugin] })
    const r2 = await runTypegen({ cwd: dir, config: {} as never, plugins: [plugin] })
    expect(r2[0].status).toBe('unchanged')
  })

  it('--check throws on drift', async () => {
    await runTypegen({ cwd: dir, config: {} as never, plugins: [plugin] })
    const drifted: TypegenPlugin = {
      ...plugin,
      async generate() {
        return 'export type Echo = "drift"'
      },
    }
    await expect(
      runTypegen({ cwd: dir, config: {} as never, plugins: [drifted], check: true }),
    ).rejects.toThrow(/drift detected/)
  })

  it('skips plugin when generate returns null', async () => {
    const skipper: TypegenPlugin = {
      id: 'test/skipper',
      inputs: [],
      async generate() {
        return null
      },
    }
    const r = await runTypegen({ cwd: dir, config: {} as never, plugins: [skipper] })
    expect(r[0].status).toBe('skipped')
    expect(r[0].outFile).toBeUndefined()
  })

  it('translates slash-delimited ids to filenames', async () => {
    const slashy: TypegenPlugin = {
      id: 'kick/db',
      inputs: [],
      async generate() {
        return 'export {}'
      },
    }
    const r = await runTypegen({ cwd: dir, config: {} as never, plugins: [slashy] })
    expect(r[0].outFile).toMatch(/kick__db\.d\.ts$/)
  })

  it('getScanResult memoizes across plugins within the same pass', async () => {
    let scanCalls = 0
    const stubScan = async () => {
      scanCalls += 1
      return {
        classes: [],
        routes: [],
        tokens: [],
        injects: [],
        env: null,
        pluginsAndAdapters: [],
        augmentations: [],
        collisions: [],
      } as never
    }
    const a: TypegenPlugin = {
      id: 'test/a',
      inputs: [],
      async generate(ctx) {
        await ctx.getScanResult({ root: '/x', cwd: '/x' } as never)
        return 'export type A = 1'
      },
    }
    const b: TypegenPlugin = {
      id: 'test/b',
      inputs: [],
      async generate(ctx) {
        // Same opts → cache hit, no extra scan.
        await ctx.getScanResult({ root: '/x', cwd: '/x' } as never)
        return 'export type B = 1'
      },
    }
    await runTypegen({
      cwd: dir,
      config: {} as never,
      plugins: [a, b],
      scan: stubScan,
    })
    expect(scanCalls).toBe(1)
  })

  it('getScanResult runs separate scans for different option shapes', async () => {
    let scanCalls = 0
    const stubScan = async () => {
      scanCalls += 1
      return {
        classes: [],
        routes: [],
        tokens: [],
        injects: [],
        env: null,
        pluginsAndAdapters: [],
        augmentations: [],
        collisions: [],
      } as never
    }
    const a: TypegenPlugin = {
      id: 'test/a',
      inputs: [],
      async generate(ctx) {
        await ctx.getScanResult({ root: '/x', cwd: '/x' } as never)
        return 'export type A = 1'
      },
    }
    const b: TypegenPlugin = {
      id: 'test/b',
      inputs: [],
      async generate(ctx) {
        // Different srcDir → cache miss, fresh scan.
        await ctx.getScanResult({ root: '/y', cwd: '/x' } as never)
        return 'export type B = 1'
      },
    }
    await runTypegen({
      cwd: dir,
      config: {} as never,
      plugins: [a, b],
      scan: stubScan,
    })
    expect(scanCalls).toBe(2)
  })
})
