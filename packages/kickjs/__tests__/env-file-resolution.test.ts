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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Container, reloadEnv, resetEnvCache } from '../src'

const KEYS = ['KICK_TEST_X', 'KICK_TEST_DEV_ONLY'] as const

let dir: string
let cwd: string

function clearKeys(): void {
  for (const k of KEYS) delete process.env[k]
  delete process.env.KICKJS_ENV_FILE
}

beforeEach(() => {
  Container.reset()
  resetEnvCache()
  clearKeys()
  cwd = process.cwd()
  dir = mkdtempSync(path.join(tmpdir(), 'kick-envres-'))
  process.chdir(dir)
})

afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
  clearKeys()
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
