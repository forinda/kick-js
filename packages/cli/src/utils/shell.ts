import { execSync, spawnSync } from 'node:child_process'

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
