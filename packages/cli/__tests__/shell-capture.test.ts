import { describe, expect, it } from 'vitest'
import { captureCommand, shellSafeInvocation } from '../src/utils/shell'

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

  it('returns null when the command exits non-zero', () => {
    expect(captureCommand('npm', ['run', 'no-such-script-here'], { timeout: 30_000 })).toBeNull()
  })
})

/**
 * The argument guard only engages on the Windows branch, so asserting it via
 * `captureCommand` would prove nothing on a Linux/macOS runner: there the
 * invocation is passed through untouched and the call fails for an unrelated
 * reason (npm rejecting a bogus package spec), which looks identical to the
 * guard firing. `shellSafeInvocation` therefore takes the platform as an
 * argument so both branches are exercised on every host.
 */
describe('shellSafeInvocation', () => {
  const WIN = 'win32' as NodeJS.Platform
  const NIX = 'linux' as NodeJS.Platform

  it('passes the command through untouched off Windows', () => {
    expect(shellSafeInvocation('npm', ['view', 'pkg', 'version'], NIX)).toEqual([
      'npm',
      ['view', 'pkg', 'version'],
    ])
  })

  it('routes through cmd.exe on Windows', () => {
    const invocation = shellSafeInvocation('npm', ['view', 'pkg', 'version'], WIN)
    expect(invocation).not.toBeNull()
    const [file, args] = invocation!
    expect(file.toLowerCase()).toContain('cmd')
    expect(args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(args[3]).toBe('npm view pkg version')
  })

  it('quotes arguments containing spaces', () => {
    expect(shellSafeInvocation('npm', ['run', 'my script'], WIN)![1][3]).toBe('npm run "my script"')
  })

  it('rejects arguments carrying shell metacharacters', () => {
    // Each of these would be command syntax, not data, if it reached cmd.exe.
    for (const evil of [
      'foo && echo pwned',
      'foo | echo pwned',
      'foo & calc',
      'foo > out.txt',
      'foo < in.txt',
      'foo ^ bar',
      'foo`whoami`',
      'foo%PATH%',
      '(foo)',
      'foo;bar',
      'foo\nbar',
      'foo"bar',
    ]) {
      expect(shellSafeInvocation('npm', ['view', evil, 'version'], WIN)).toBeNull()
    }
  })

  it('rejects a metacharacter in the command name itself', () => {
    expect(shellSafeInvocation('npm && calc', ['--version'], WIN)).toBeNull()
  })

  /**
   * A backslash is not shell syntax, but Windows argv quoting corrupts it:
   * `['C:\some path\']` reaches the child as `['"C:\some', 'path\"']` — one
   * argument silently becomes two. Rejecting beats corrupting.
   */
  it('rejects backslashes, which Windows quoting would mangle', () => {
    expect(shellSafeInvocation('npm', ['view', 'C:\\some path\\', 'version'], WIN)).toBeNull()
    expect(shellSafeInvocation('npm', ['view', 'no-space\\', 'version'], WIN)).toBeNull()
  })

  it('still accepts the argument shapes the CLI actually passes', () => {
    // Scoped names, dist-tag specs, flags — none may trip the guard.
    for (const args of [
      ['view', '@forinda/kickjs', 'version'],
      ['view', '@forinda/kickjs@alpha', 'exports', '--json'],
      ['view', '@forinda/kickjs-cli@latest', 'version'],
      ['install'],
      ['--version'],
    ]) {
      expect(shellSafeInvocation('npm', args, WIN)).not.toBeNull()
    }
  })
})
