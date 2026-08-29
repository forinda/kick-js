import { execFile, execFileSync, execSync, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Characters an argument may not contain when it has to travel through
 * `cmd.exe`.
 *
 * The first group is shell syntax — `cmd.exe` would interpret these rather
 * than pass them through. The trailing `\\` is different in kind: a backslash
 * is not shell syntax, but Windows command-line quoting mangles it. Node's
 * argv encoder doubles trailing backslashes, and a backslash immediately
 * before a closing quote escapes that quote, so a single argument silently
 * splits in two:
 *
 *   ['C:\\some path\\']  →  cmd receives  ['"C:\\some', 'path\\"']
 *   ['no-space\\']       →  cmd receives  ['no-space\\\\']
 *
 * Correct escaping is possible but fiddly, and no caller in this CLI needs it
 * — arguments here are package names, dist-tags, subcommands and flags, and
 * working directories travel via the `cwd` option rather than as arguments.
 * So a backslash is rejected outright: a loud `null` beats a silently
 * corrupted argument, which is the exact failure mode this module exists to
 * eliminate.
 */
const CMD_UNSAFE = /[&|<>^"'`(){}[\];!%\r\n\\]/

/**
 * Build the `[file, args]` pair to hand to `execFileSync`, routing through
 * `cmd.exe` on Windows so `.cmd` shims are launchable.
 *
 * On Windows, `npm` / `pnpm` / `yarn` / `bun` are `.cmd` batch shims, not
 * `.exe`s, and `execFileSync` cannot launch either spelling:
 *
 *   - `execFileSync('npm', …)`     → ENOENT  (there is no `npm.exe` on PATH)
 *   - `execFileSync('npm.cmd', …)` → EINVAL  (Node >= 18.20 / 20.12 refuses to
 *                                             spawn batch files without a
 *                                             shell — CVE-2024-27980)
 *
 * Both failures are silent wherever the caller swallows the error, so the
 * command looks like it "returned nothing" rather than "never ran".
 *
 * `/d` skips AutoRun registry commands, `/s` makes cmd treat everything after
 * `/c` as one verbatim string (it strips only the outer quote pair Node adds).
 * Returns `null` when an argument is unsafe to pass through — refusing to run
 * beats running something the shell rewrote.
 *
 * `platform` is injectable so both branches are unit-testable from any host
 * OS; production callers use the default. It is read per call rather than
 * captured at import time for the same reason.
 */
export function shellSafeInvocation(
  file: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): [string, string[]] | null {
  if (platform !== 'win32') return [file, args]
  if (CMD_UNSAFE.test(file) || args.some((a) => CMD_UNSAFE.test(a))) return null
  const command = [file, ...args].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')
  return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command]]
}

/**
 * Run a command and capture its trimmed stdout, cross-platform.
 *
 * Returns `null` if the command is missing, exits non-zero, times out, or
 * carries arguments unsafe to pass through `cmd.exe`. Callers treat `null` as
 * "unknown" and fall back — the point of this helper is that a Windows `.cmd`
 * shim no longer masquerades as a failed command.
 */
export function captureCommand(
  file: string,
  args: string[],
  opts: { timeout?: number; cwd?: string } = {},
): string | null {
  const invocation = shellSafeInvocation(file, args)
  if (!invocation) return null
  try {
    const out = execFileSync(invocation[0], invocation[1], {
      encoding: 'utf-8',
      timeout: opts.timeout ?? 5000,
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    const trimmed = out.toString().trim()
    return trimmed || null
  } catch {
    return null
  }
}

/**
 * Run a command with inherited stdio, cross-platform. Throws on failure so
 * callers can decide whether a missing package manager is fatal.
 */
export function runCommand(file: string, args: string[], opts: { cwd?: string } = {}): void {
  const invocation = shellSafeInvocation(file, args)
  if (!invocation) throw new Error(`Refusing to run '${file}': unsafe arguments`)
  execFileSync(invocation[0], invocation[1], {
    cwd: opts.cwd,
    stdio: 'inherit',
    windowsHide: true,
  })
}

/**
 * Run a shell command synchronously, printing output.
 *
 * On Windows, `execSync` spawns via `cmd.exe` by default, which means
 * POSIX-style inline env prefixes like `FOO=bar node app.js` do NOT work.
 * Callers that need environment variables should pass them in the `env`
 * option instead of prepending them to the command string — see
 * `runNodeWithEnv` for the cross-platform helper that avoids a shell
 * entirely.
 */
export function runShellCommand(command: string, cwd?: string, env?: NodeJS.ProcessEnv): void {
  execSync(command, {
    cwd,
    stdio: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  })
}

/**
 * Cross-platform way to launch a Node.js process with a set of
 * environment variables. Uses `spawnSync` with an argument array so no
 * shell is involved — the `VAR=value node ...` POSIX prefix syntax that
 * `runShellCommand` relied on breaks on cmd.exe and PowerShell.
 */
export function runNodeWithEnv(entry: string, env: NodeJS.ProcessEnv, cwd?: string): void {
  const result = spawnSync(process.execPath, [entry], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

/**
 * Async twin of `captureCommand` — same Windows `.cmd` routing, same
 * `null`-on-any-failure contract, but genuinely concurrent.
 *
 * `captureCommand` is `execFileSync`, so `Promise.all` over it runs the
 * commands one after another. Callers that fan out over a list of network
 * queries (`npm view` per package) need real concurrency, otherwise the
 * per-call timeout multiplies by the list length.
 */
export async function captureCommandAsync(
  file: string,
  args: string[],
  opts: { timeout?: number; cwd?: string } = {},
): Promise<string | null> {
  const invocation = shellSafeInvocation(file, args)
  if (!invocation) return null
  try {
    const { stdout } = await execFileAsync(invocation[0], invocation[1], {
      encoding: 'utf-8',
      timeout: opts.timeout ?? 5000,
      cwd: opts.cwd,
      windowsHide: true,
    })
    return stdout.toString().trim() || null
  } catch {
    return null
  }
}
