/**
 * Proves the *real* dev-server scenario: editing the `.env` FILE and
 * triggering `reloadEnv()` (what `envWatchPlugin` does on a `.env` change)
 * actually pushes the new value through dotenv into `process.env` and out
 * via `ConfigService` — no restart.
 *
 * The sibling `config-reload.test.ts` only mutates `process.env` directly;
 * this one goes through `dotenv.config({ override: true })` reading the
 * file from disk, which is the path that historically broke ("DATABASE_URL
 * undefined until restart" — dotenv's default `override: false` keeps the
 * stale value on the second read).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { ConfigService, Container, defineEnv, loadEnv, reloadEnv, resetEnvCache } from '../src'

let dir: string
let cwd: string

beforeEach(() => {
  Container.reset()
  resetEnvCache()
  delete process.env.KICK_TEST_REFRESH
  cwd = process.cwd()
  dir = mkdtempSync(path.join(tmpdir(), 'kick-env-'))
  process.chdir(dir)
})

afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
  delete process.env.KICK_TEST_REFRESH
})

describe('reloadEnv() refreshes values from a changed .env file', () => {
  it('picks up an edited key without a restart (dotenv override path)', () => {
    writeFileSync('.env', 'KICK_TEST_REFRESH=old\n')
    // Seed process.env from the file the way boot does.
    require('dotenv').config({ override: true, quiet: true })

    const schema = defineEnv((base) => base.extend({ KICK_TEST_REFRESH: z.string() }))
    loadEnv(schema)
    const config = Container.getInstance().resolve(ConfigService)
    expect(config.get('KICK_TEST_REFRESH')).toBe('old')

    // The actual user action: change the FILE on disk.
    writeFileSync('.env', 'KICK_TEST_REFRESH=new\n')

    // What envWatchPlugin calls on a `.env` change.
    reloadEnv()

    // Must reflect the new file contents — the whole point.
    expect(config.get('KICK_TEST_REFRESH')).toBe('new')
  })

  it('reloadEnv() overrides an existing process.env value from the file', () => {
    // Key already present in the environment (e.g. exported in the shell)
    // AND in the file — the file edit must win on reload.
    process.env.KICK_TEST_REFRESH = 'from-shell'
    writeFileSync('.env', 'KICK_TEST_REFRESH=from-file-v1\n')
    require('dotenv').config({ override: true, quiet: true })

    const schema = defineEnv((base) => base.extend({ KICK_TEST_REFRESH: z.string() }))
    loadEnv(schema)
    const config = Container.getInstance().resolve(ConfigService)
    expect(config.get('KICK_TEST_REFRESH')).toBe('from-file-v1')

    writeFileSync('.env', 'KICK_TEST_REFRESH=from-file-v2\n')
    reloadEnv()
    expect(config.get('KICK_TEST_REFRESH')).toBe('from-file-v2')
  })
})
