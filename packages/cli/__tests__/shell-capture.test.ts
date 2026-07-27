import { describe, expect, it } from 'vitest'
import { captureCommand } from '../src/utils/shell'

/**
 * Regression guard for the "scaffolded projects pin every sibling to the
 * CLI's own version" bug.
 *
 * `resolveSiblingVersions()` shells out to `npm view <pkg> version` and
 * falls back to the CLI's version whenever the query fails. On Windows
 * that query ALWAYS failed — `npm` is a `.cmd` batch shim, so
 * `execFileSync('npm', …)` raised ENOENT (no `npm.exe`) and
 * `execFileSync('npm.cmd', …)` raised EINVAL (Node >= 18.20 refuses to
 * spawn batch files without a shell — CVE-2024-27980). Because the
 * caller swallowed the error, every generated `package.json` silently
 * collapsed onto the CLI version instead of each package's real one.
 *
 * These tests exercise the real `npm` binary on whatever platform they
 * run on, which is exactly the case that used to break.
 */
describe('captureCommand', () => {
  it('runs a package-manager shim and captures its stdout', () => {
    // `npm --version` is offline, fast, and — critically — is the `.cmd`
    // shim on Windows that plain execFileSync cannot launch.
    const out = captureCommand('npm', ['--version'], { timeout: 30_000 })
    expect(out).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('captures multi-token arguments without a shell rewriting them', () => {
    const out = captureCommand('npm', ['config', 'get', 'registry'], { timeout: 30_000 })
    expect(out).toMatch(/^https?:\/\//)
  })

  it('returns null for a command that does not exist', () => {
    expect(captureCommand('kick-definitely-not-a-real-binary', ['--version'])).toBeNull()
  })

  it('refuses arguments carrying shell metacharacters', () => {
    // Must not reach a shell that would treat `&&` as a command separator.
    expect(captureCommand('npm', ['view', 'foo && echo pwned', 'version'])).toBeNull()
    expect(captureCommand('npm', ['view', 'foo | echo pwned', 'version'])).toBeNull()
    expect(captureCommand('npm', ['view', 'foo`whoami`', 'version'])).toBeNull()
  })

  it('returns null when the command exits non-zero', () => {
    expect(captureCommand('npm', ['run', 'no-such-script-here'], { timeout: 30_000 })).toBeNull()
  })
})
