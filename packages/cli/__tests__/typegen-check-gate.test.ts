import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// The real builtins module transitively imports every command (init.ts
// reads package.json relative to dist/), which can't load from src under
// vitest. These tests only care about the wrapper's error handling, so
// the built-in plugin list is stubbed empty and fixtures come in via
// `config.plugins`.
vi.mock('../src/plugin/builtins', () => ({ builtinCliPlugins: [] }))

import { runAllPluginTypegens } from '../src/typegen/run-plugins'
import { TypegenDriftError, type TypegenPlugin } from '../src/typegen/plugin'
import { defineCliPlugin } from '../src/plugin/types'
import type { KickConfig } from '../src/config'

// Regression suite for the `--check` CI gate.
//
// The bug: `runAllPluginTypegens` wraps the whole plugin pass in a catch
// that downgrades failures to a `console.warn` so a transiently-broken
// plugin can't crash the `kick dev` loop. That catch also swallowed the
// deliberate drift throw and returned `[]`, so the command's
// `results.some(r => r.status === 'written')` check saw an empty array
// and exited 0. `--check` never failed a build for any plugin.
//
// `typegen-runner.test.ts` covered the runner, which threw correctly all
// along — the swallow was one layer up, which is why the existing test
// stayed green. These tests pin the wrapper.

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kick-check-gate-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function configWith(typegens: TypegenPlugin[]): KickConfig {
  return {
    plugins: [defineCliPlugin({ name: 'test/fixture', typegens })],
  } as unknown as KickConfig
}

const echo = (body: string): TypegenPlugin => ({
  id: 'test/echo',
  inputs: [],
  async generate() {
    return body
  },
})

describe('runAllPluginTypegens — --check gate', () => {
  it('propagates drift instead of swallowing it (the regression)', async () => {
    // Seed the on-disk output.
    await runAllPluginTypegens({ cwd: dir, config: configWith([echo('export type A = 1')]) })

    // Same plugin id, different output → drift.
    await expect(
      runAllPluginTypegens({
        cwd: dir,
        config: configWith([echo('export type A = 2')]),
        check: true,
      }),
    ).rejects.toBeInstanceOf(TypegenDriftError)
  })

  it('does not report drift as a warning + empty result set', async () => {
    await runAllPluginTypegens({ cwd: dir, config: configWith([echo('export type A = 1')]) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      runAllPluginTypegens({
        cwd: dir,
        config: configWith([echo('export type A = 2')]),
        check: true,
      }),
    ).rejects.toThrow()

    // The old behaviour: warn("… skipped (…)") and return [] → exit 0.
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('skipped'))
  })

  it('names every drifted file so one CI run reports the full list', async () => {
    const two = (a: string, b: string): TypegenPlugin[] => [
      { id: 'test/one', inputs: [], generate: async () => a },
      { id: 'test/two', inputs: [], generate: async () => b },
    ]
    await runAllPluginTypegens({ cwd: dir, config: configWith(two('one', 'two')) })

    const err = await runAllPluginTypegens({
      cwd: dir,
      config: configWith(two('one-changed', 'two-changed')),
      check: true,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(TypegenDriftError)
    const drifted = (err as TypegenDriftError).drifted.map((d) => d.id)
    expect(drifted).toEqual(['test/one', 'test/two'])
    expect((err as TypegenDriftError).message).toContain('kick typegen')
  })

  it('passes cleanly when generated output matches disk', async () => {
    await runAllPluginTypegens({ cwd: dir, config: configWith([echo('export type A = 1')]) })
    const results = await runAllPluginTypegens({
      cwd: dir,
      config: configWith([echo('export type A = 1')]),
      check: true,
    })
    expect(results.every((r) => r.status === 'unchanged')).toBe(true)
  })

  it('fails the gate when a plugin cannot generate at all', async () => {
    // A gate that cannot verify a file must not pass it.
    const broken: TypegenPlugin = {
      id: 'test/broken',
      inputs: [],
      async generate() {
        throw new Error('boom')
      },
    }
    await expect(
      runAllPluginTypegens({ cwd: dir, config: configWith([broken]), check: true }),
    ).rejects.toThrow(/failed to generate/)
  })

  it('still shields the dev loop from a broken plugin when not checking', async () => {
    // The catch exists for a reason — preserve it outside --check.
    const broken: TypegenPlugin = {
      id: 'test/broken',
      inputs: [],
      async generate() {
        throw new Error('boom')
      },
    }
    const results = await runAllPluginTypegens({ cwd: dir, config: configWith([broken]) })
    expect(results.find((r) => r.id === 'test/broken')?.status).toBe('error')
  })
})
