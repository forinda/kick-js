/**
 * Tests for `kick explain` and the known-issues registry.
 *
 * Two layers of coverage:
 *   1. Unit tests on the registry — every known issue should match the
 *      error patterns it claims to recognize, with the right confidence
 *      ranking, and should NOT match unrelated errors (no false hits).
 *   2. E2E tests on the command — positional arg, --message flag,
 *      stdin pipe, --json output, and the no-match exit path.
 *
 * @module @forinda/kickjs-cli/__tests__/explain.test
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBestMatch, KNOWN_ISSUES } from '../src/explain/known-issues'

// ── Local CLI runner with stdin support ──────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI_BIN = resolve(__dirname, '..', 'dist', 'cli.mjs')

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Run the built CLI with optional stdin input.
 *
 * Unlike the shared `runCli` helper this command doesn't need a
 * fixture project — `kick explain` is stateless and reads everything
 * from arguments / stdin. We also need to feed stdin, which the
 * shared helper doesn't support.
 */
function runExplain(args: string[], opts: { stdin?: string } = {}): RunResult {
  if (!existsSync(CLI_BIN)) {
    throw new Error(`CLI binary not found at ${CLI_BIN}. Run pnpm --filter cli build first.`)
  }
  const result = spawnSync('node', [CLI_BIN, ...args], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    input: opts.stdin,
    env: { ...process.env, NO_COLOR: '1' },
  })
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

// ── Unit: known-issues matchers ───────────────────────────────────────────

describe('known-issues registry', () => {
  it('matches env-schema-not-registered for config.get + undefined', () => {
    const m = findBestMatch("config.get('DATABASE_URL') returned undefined")
    expect(m).not.toBeNull()
    expect(m!.diagnosis.id).toBe('env-schema-not-registered')
    expect(m!.confidence).toBeGreaterThanOrEqual(70)
  })

  it('matches reflect-metadata-missing for the canonical error', () => {
    const m = findBestMatch('TypeError: Reflect.getMetadata is not a function')
    expect(m).not.toBeNull()
    expect(m!.diagnosis.id).toBe('reflect-metadata-missing')
    expect(m!.confidence).toBeGreaterThanOrEqual(80)
  })

  it('matches module-decorator-not-found for the @Module pattern', () => {
    const m = findBestMatch('@forinda/kickjs has no exported member Module')
    expect(m).not.toBeNull()
    expect(m!.diagnosis.id).toBe('module-decorator-not-found')
  })

  it('matches container-not-reset-in-tests for "already registered" in vitest', () => {
    const m = findBestMatch(
      'vitest: UserService is already registered in container at __tests__/foo.test.ts:12',
    )
    expect(m).not.toBeNull()
    expect(m!.diagnosis.id).toBe('container-not-reset-in-tests')
    expect(m!.confidence).toBeGreaterThanOrEqual(80)
  })

  it('matches legacy-kick-routes-bracket-syntax for the old form', () => {
    const m = findBestMatch(
      "Type 'KickRoutes[\"POST /users\"]' is not assignable to parameter of type Ctx",
    )
    expect(m).not.toBeNull()
    expect(m!.diagnosis.id).toBe('legacy-kick-routes-bracket-syntax')
    expect(m!.confidence).toBeGreaterThanOrEqual(90)
  })

  it('matches cluster-in-vite-dev when both signals are present', () => {
    const m = findBestMatch(
      'kick dev started cluster workers, port 5174 EADDRINUSE — duplicate server',
    )
    expect(m).not.toBeNull()
    expect(m!.diagnosis.id).toBe('cluster-in-vite-dev')
  })

  it('returns null for completely unrelated errors', () => {
    const m = findBestMatch('the rocket motor failed to ignite at T-minus 3')
    expect(m).toBeNull()
  })

  it('every known issue exposes a callable matcher', () => {
    for (const issue of KNOWN_ISSUES) {
      expect(typeof issue.match).toBe('function')
    }
  })

  it('discards low-confidence matches below the 40 threshold', () => {
    // Vague enough that no matcher should clear 40 confidence.
    const m = findBestMatch('hello world')
    expect(m).toBeNull()
  })
})

// ── E2E: kick explain command ────────────────────────────────────────────

describe('kick explain command', () => {
  it('explains a known error from a positional arg', () => {
    const result = runExplain(['explain', "config.get('FOO') returned undefined"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('env-schema-not-registered')
    expect(result.stdout).toContain('Diagnosis:')
    expect(result.stdout).toContain('Fix:')
  })

  it('accepts the --message flag instead of a positional arg', () => {
    const result = runExplain([
      'explain',
      '--message',
      'TypeError: Reflect.getMetadata is not a function',
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('reflect-metadata-missing')
  })

  it('accepts input from stdin when no arg or flag is given', () => {
    const result = runExplain(['explain'], {
      stdin: '@forinda/kickjs has no exported member Module',
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('module-decorator-not-found')
  })

  it('emits JSON when --json is set', () => {
    const result = runExplain(['explain', '--json', "config.get('X') is undefined"])
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout) as {
      matched: boolean
      confidence: number
      diagnosis: { id: string; title: string }
    }
    expect(parsed.matched).toBe(true)
    expect(parsed.diagnosis.id).toBe('env-schema-not-registered')
    expect(typeof parsed.diagnosis.title).toBe('string')
  })

  it('exits with code 2 on no-match without --ai', () => {
    const result = runExplain(['explain', 'unrelated rocket motor error'])
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toContain('No known-issue matched')
  })

  it('exits with code 0 on no-match WITH --ai (placeholder behavior)', () => {
    const result = runExplain(['explain', '--ai', 'unrelated rocket motor error'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('not yet wired')
  })

  it('errors with a helpful message on completely empty input', () => {
    // Empty stdin string forces stdin to close immediately so the
    // command doesn't hang waiting for input.
    const result = runExplain(['explain'], { stdin: '' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('no input provided')
  })
})
