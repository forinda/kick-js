import { execSync } from 'node:child_process'

/** Run a shell command synchronously, printing output */
export function runShellCommand(command: string, cwd?: string): void {
  execSync(command, {
    cwd,
    stdio: 'inherit',
  })
}
