/**
 * E2E coverage for `kick new <name> --yes`.
 *
 * The non-interactive flag swaps every prompt for a default
 * (template=minimal, repo=inmemory, no extras, git+install on, pm
 * resolved via the same chain `kick add` uses). These tests pin that
 * contract — both the happy path and the "won't silently nuke an
 * existing dir" guardrail.
 *
 * @module @forinda/kickjs-cli/__tests__/kick-new-yes.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI_BIN = resolve(__dirname, '..', 'dist', 'cli.mjs')

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Run the built CLI in a clean cwd with prompts disabled via --yes / --no-* flags */
function runNew(cwd: string, args: string[]): RunResult {
  const result = spawnSync('node', [CLI_BIN, 'new', ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  })
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('kick new --yes (non-interactive)', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'kick-new-yes-'))
  })

  afterEach(() => {
    try {
      rmSync(cwd, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('scaffolds with minimal+inmemory defaults from a name + --yes', () => {
    const result = runNew(cwd, ['my-api', '--yes', '--no-install', '--no-git'])
    expect(result.exitCode).toBe(0)

    const projectDir = join(cwd, 'my-api')
    expect(existsSync(projectDir)).toBe(true)

    // Default template — minimal
    const config = readFileSync(join(projectDir, 'kick.config.ts'), 'utf-8')
    expect(config).toContain(`pattern: 'minimal'`)
    // Default repo — inmemory
    expect(config).toContain(`repo: 'inmemory'`)

    // Sanity: no prompt strings leaked into stdout
    expect(result.stdout).not.toContain('Project template')
    expect(result.stdout).not.toContain('Default repository/ORM')
    expect(result.stdout).not.toContain('Initialize git repository')
  })

  it('--non-interactive is an alias for --yes', () => {
    const result = runNew(cwd, ['my-api', '--non-interactive', '--no-install', '--no-git'])
    expect(result.exitCode).toBe(0)
    const config = readFileSync(join(cwd, 'my-api', 'kick.config.ts'), 'utf-8')
    expect(config).toContain(`pattern: 'minimal'`)
  })

  it('explicit flags override --yes defaults', () => {
    const result = runNew(cwd, [
      'my-api',
      '--yes',
      '--template',
      'rest',
      '--repo',
      'drizzle',
      '--no-install',
      '--no-git',
    ])
    expect(result.exitCode).toBe(0)
    const config = readFileSync(join(cwd, 'my-api', 'kick.config.ts'), 'utf-8')
    expect(config).toContain(`pattern: 'rest'`)
    expect(config).toContain(`repo: 'drizzle'`)
  })

  it('aborts cleanly when target dir is non-empty and --force is missing', () => {
    const target = join(cwd, 'my-api')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'existing.txt'), 'do not destroy')

    const result = runNew(cwd, ['my-api', '--yes', '--no-install', '--no-git'])
    expect(result.exitCode).toBe(0) // graceful exit, not crash
    expect(result.stdout + result.stderr).toMatch(/Pass --force to clear it/)

    // Existing file untouched
    expect(readFileSync(join(target, 'existing.txt'), 'utf-8')).toBe('do not destroy')
    // Scaffold did NOT proceed
    expect(existsSync(join(target, 'kick.config.ts'))).toBe(false)
  })

  it('clears non-empty dir and scaffolds when --force is passed alongside --yes', () => {
    const target = join(cwd, 'my-api')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'existing.txt'), 'will be removed')

    const result = runNew(cwd, ['my-api', '--yes', '--force', '--no-install', '--no-git'])
    expect(result.exitCode).toBe(0)
    expect(existsSync(join(target, 'existing.txt'))).toBe(false)
    expect(existsSync(join(target, 'kick.config.ts'))).toBe(true)
  })
})
