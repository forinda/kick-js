import { execFileSync, execSync, spawnSync } from 'node:child_process'

/**
 * Whether a command needs to be routed through `cmd.exe` to run.
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
 */
const NEEDS_SHELL = process.platform === 'win32'

/**
 * Characters that `cmd.exe` would interpret rather than pass through. Every
 * argument we route through the shell is checked against this: callers pass
 * package names, dist-tags and allowlisted binary names, none of which
 * legitimately contain these.
 */
const CMD_METACHARACTERS = /[&|<>^"'`(){}[\];!%\r\n]/

/**
 * Build the `[file, args]` pair to hand to `execFileSync`, routing through
 * `cmd.exe` on Windows so `.cmd` shims are launchable.
 *
 * `/d` skips AutoRun registry commands, `/s` makes cmd treat everything after
 * `/c` as one verbatim string (it strips only the outer quote pair Node adds).
 * Returns `null` when an argument contains shell metacharacters — refusing to
 * run beats running something the shell rewrote.
 */
function shellSafeInvocation(file: string, args: string[]): [string, string[]] | null {
  if (!NEEDS_SHELL) return [file, args]
  if (CMD_METACHARACTERS.test(file) || args.some((a) => CMD_METACHARACTERS.test(a))) return null
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
