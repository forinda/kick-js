/**
 * Proves the test-isolation contract of the dotenv boot step: under a
 * test run, a `.env.test` on disk wins outright and the developer's
 * `.env` is not read at all.
 *
 * The bug this locks down: `dotenv.config({ override: false })` runs as
 * an import-time side effect of `@forinda/kickjs`, so every key a test
 * runner forgets to pin gets silently backfilled from `.env`. A suite
 * can pin its database URL and still reach live development services
 * through the keys it forgot — and nothing in the run says so. The
 * short-circuit (rather than a `.env.test` → `.env` cascade) is what
 * closes that hole: falling through IS the leak.
 *
 * `tryLoadDotenv()` only runs at module load, so these cases drive it
 * through `reloadEnv()`, which routes to the same resolver.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Container, reloadEnv, resetEnvCache } from '../src'
import { appliedKeys } from '../src/config/env'

const KEYS = ['KICK_TEST_X', 'KICK_TEST_DEV_ONLY'] as const

let dir: string
let cwd: string
let nodeEnv: string | undefined
let vitestFlag: string | undefined

function clearKeys(): void {
  for (const k of KEYS) delete process.env[k]
  delete process.env.KICKJS_ENV_FILE
}

beforeEach(() => {
  Container.reset()
  resetEnvCache()
  clearKeys()
  nodeEnv = process.env.NODE_ENV
  vitestFlag = process.env.VITEST
  cwd = process.cwd()
  dir = mkdtempSync(path.join(tmpdir(), 'kick-envres-'))
  process.chdir(dir)
})

afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
  clearKeys()
  // The mode cases below drive NODE_ENV directly; restore it so a stray
  // value can't leak into the next file's expectations.
  if (nodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = nodeEnv
  if (vitestFlag === undefined) delete process.env.VITEST
  else process.env.VITEST = vitestFlag
})

/** Both files present — the shape a leaking project actually has. */
function writeBothEnvFiles(): void {
  writeFileSync('.env', 'KICK_TEST_X=dev\nKICK_TEST_DEV_ONLY=leaked\n')
  writeFileSync('.env.test', 'KICK_TEST_X=test\n')
}

describe('env file resolution under a test run', () => {
  it('reads .env.test and does NOT fall through to .env', () => {
    expect(process.env.NODE_ENV === 'test' || !!process.env.VITEST).toBe(true)
    writeBothEnvFiles()

    reloadEnv()

    expect(process.env.KICK_TEST_X).toBe('test')
    // The regression: a key present only in `.env` must not appear.
    // Before the fix this was 'leaked'.
    expect(process.env.KICK_TEST_DEV_ONLY).toBeUndefined()
  })

  it('KICKJS_ENV_FILE=off skips dotenv entirely', () => {
    writeBothEnvFiles()
    process.env.KICKJS_ENV_FILE = 'off'

    reloadEnv()

    expect(process.env.KICK_TEST_X).toBeUndefined()
    expect(process.env.KICK_TEST_DEV_ONLY).toBeUndefined()
  })

  it('KICKJS_ENV_FILE names the file(s) to read, overriding the test default', () => {
    writeBothEnvFiles()
    process.env.KICKJS_ENV_FILE = '.env'

    reloadEnv()

    // Explicit opt-back-in to the old behaviour — the compat escape hatch.
    expect(process.env.KICK_TEST_X).toBe('dev')
    expect(process.env.KICK_TEST_DEV_ONLY).toBe('leaked')
  })

  it('falls back to .env when no .env.test exists (unchanged for existing apps)', () => {
    writeFileSync('.env', 'KICK_TEST_X=dev\nKICK_TEST_DEV_ONLY=leaked\n')

    reloadEnv()

    expect(process.env.KICK_TEST_X).toBe('dev')
    expect(process.env.KICK_TEST_DEV_ONLY).toBe('leaked')
  })
})

/**
 * Non-test modes follow the cascade Vite popularised: mode-specific files
 * outrank every generic one, and keys that appear only in a generic file
 * are still available. Test mode is the deliberate exception, covered above.
 */
describe('env file cascade for non-test modes', () => {
  /** Drive the resolver as `production` rather than the ambient test run. */
  function asProduction(): void {
    process.env.NODE_ENV = 'production'
    delete process.env.VITEST
  }

  it('layers .env.production over .env instead of replacing it', () => {
    asProduction()
    writeFileSync('.env', 'KICK_TEST_X=base\nKICK_TEST_DEV_ONLY=from-base\n')
    writeFileSync('.env.production', 'KICK_TEST_X=prod\n')

    reloadEnv()

    expect(process.env.KICK_TEST_X).toBe('prod')
    // The whole point of layering: base-only keys survive.
    expect(process.env.KICK_TEST_DEV_ONLY).toBe('from-base')
  })

  it('ranks .env.[mode] above .env.local, per Vite', () => {
    asProduction()
    writeFileSync('.env.local', 'KICK_TEST_X=local\n')
    writeFileSync('.env.production', 'KICK_TEST_X=prod\n')

    reloadEnv()

    // Mode beats generic — including generic `.local`.
    expect(process.env.KICK_TEST_X).toBe('prod')
  })

  it('ranks .env.[mode].local highest of the four', () => {
    asProduction()
    writeFileSync('.env', 'KICK_TEST_X=base\n')
    writeFileSync('.env.local', 'KICK_TEST_X=local\n')
    writeFileSync('.env.production', 'KICK_TEST_X=prod\n')
    writeFileSync('.env.production.local', 'KICK_TEST_X=prod-local\n')

    reloadEnv()

    expect(process.env.KICK_TEST_X).toBe('prod-local')
  })

  it('keeps precedence under reloadEnv (override:true reverses dotenv order)', () => {
    // Regression guard: dotenv resolves array precedence positionally and
    // flips direction with `override: true`. Without reversing the array,
    // a reload lets `.env` beat `.env.production` — the cascade silently
    // inverts on the HMR path only.
    asProduction()
    writeFileSync('.env', 'KICK_TEST_X=base\n')
    writeFileSync('.env.production', 'KICK_TEST_X=prod\n')

    reloadEnv()
    expect(process.env.KICK_TEST_X).toBe('prod')

    // Second reload — the override path runs again over already-set vars.
    writeFileSync('.env.production', 'KICK_TEST_X=prod-v2\n')
    reloadEnv()
    expect(process.env.KICK_TEST_X).toBe('prod-v2')
  })

  it('still isolates under test mode, .local included', () => {
    writeFileSync('.env', 'KICK_TEST_X=dev\nKICK_TEST_DEV_ONLY=leaked\n')
    writeFileSync('.env.local', 'KICK_TEST_DEV_ONLY=leaked-local\n')
    writeFileSync('.env.test.local', 'KICK_TEST_X=test-local\n')

    reloadEnv()

    expect(process.env.KICK_TEST_X).toBe('test-local')
    // Neither generic file contributes — `.env.local` is a developer's
    // personal machine config, which is precisely what must not leak in.
    expect(process.env.KICK_TEST_DEV_ONLY).toBeUndefined()
  })
})

/**
 * The backfill warning must name only the vars dotenv ACTUALLY applied.
 *
 * `result.parsed` is everything read out of the files, not everything
 * applied: under `override: false` a key the test runner already pinned
 * keeps the runner's value and the file's copy is discarded. Reporting
 * those would name vars the user got right, which inverts the message —
 * it exists to say what leaked IN.
 */
describe('backfill warning accounting', () => {
  it('excludes keys whose value the runner already pinned', () => {
    // Models the override:false boot path: PINNED is already in
    // process.env, so dotenv leaves it and only NEW_KEY is applied.
    process.env.KICK_TEST_X = 'from-runner'
    const before = { ...process.env }
    process.env.KICK_TEST_DEV_ONLY = 'from-file'

    const applied = appliedKeys(before, {
      KICK_TEST_X: 'from-file',
      KICK_TEST_DEV_ONLY: 'from-file',
    })

    expect(applied).toEqual(['KICK_TEST_DEV_ONLY'])
  })

  it('reports nothing when every parsed key was already pinned', () => {
    process.env.KICK_TEST_X = 'from-runner'
    const before = { ...process.env }

    expect(appliedKeys(before, { KICK_TEST_X: 'from-file' })).toEqual([])
  })

  it('names every var the reload actually changed', () => {
    // End-to-end through reloadEnv, which is the `override: true` path — so
    // the file wins over the pre-set value and BOTH keys genuinely change.
    // Both must therefore be named; the runner-pinned exclusion is an
    // `override: false` behaviour, covered by the unit cases above.
    process.env.KICK_TEST_X = 'from-runner'
    writeFileSync('.env', 'KICK_TEST_X=from-file\nKICK_TEST_DEV_ONLY=leaked\n')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      reloadEnv()
      const message = warn.mock.calls.map((c) => String(c[0])).join('\n')
      expect(message).toContain('KICK_TEST_X')
      expect(message).toContain('KICK_TEST_DEV_ONLY')
      expect(message).toContain('2 env var(s) from')
      expect(process.env.KICK_TEST_X).toBe('from-file')
    } finally {
      warn.mockRestore()
    }
  })

  it('stays silent when the generic files change nothing', () => {
    // Every key in .env already matches process.env — nothing was taken,
    // so there is nothing to warn about.
    process.env.KICK_TEST_X = 'same'
    writeFileSync('.env', 'KICK_TEST_X=same\n')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      reloadEnv()
      const kickjsWarnings = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('[kickjs]'))
      expect(kickjsWarnings).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })
})

/**
 * `envMode()` (file selection) and `isTestRun()` (the backfill warning)
 * must agree about what a test run is.
 *
 * They didn't. `envMode()` read `NODE_ENV ?? (VITEST ? 'test' : ...)`, so an
 * explicitly-set `NODE_ENV=development` won file selection, while
 * `isTestRun()` counted `VITEST` on its own and still gated the warning. A
 * vitest run with `NODE_ENV=development` exported — a shell profile, a CI
 * image — skipped the `.env.test` sitting right there, loaded the developer's
 * `.env`, and then printed a warning telling the user to create the very file
 * it had just ignored.
 */
describe('test-run detection drives file selection', () => {
  it('isolates when VITEST is set even if NODE_ENV says development', () => {
    process.env.NODE_ENV = 'development'
    process.env.VITEST = 'true'
    writeFileSync('.env', 'KICK_TEST_X=dev\nKICK_TEST_DEV_ONLY=leaked\n')
    writeFileSync('.env.test', 'KICK_TEST_X=test\n')

    reloadEnv()

    expect(process.env.KICK_TEST_X).toBe('test')
    expect(process.env.KICK_TEST_DEV_ONLY).toBeUndefined()
  })

  it('never warns about a leak while skipping the file that prevents it', () => {
    // The contradiction itself: warning fired, isolation bypassed.
    process.env.NODE_ENV = 'development'
    process.env.VITEST = 'true'
    writeFileSync('.env', 'KICK_TEST_X=dev\nKICK_TEST_DEV_ONLY=leaked\n')
    writeFileSync('.env.test', 'KICK_TEST_X=test\n')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      reloadEnv()
      const told = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[kickjs]'))
      expect(told).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('still honours a real non-test NODE_ENV when not under a runner', () => {
    // The fix must not make everything look like a test run.
    process.env.NODE_ENV = 'production'
    delete process.env.VITEST
    writeFileSync('.env', 'KICK_TEST_X=base\n')
    writeFileSync('.env.production', 'KICK_TEST_X=prod\n')
    writeFileSync('.env.test', 'KICK_TEST_X=test\n')

    reloadEnv()

    expect(process.env.KICK_TEST_X).toBe('prod')
  })
})
