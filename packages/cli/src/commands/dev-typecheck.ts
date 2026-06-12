/**
 * Dev-mode TypeScript check worker for `kick dev --typecheck`.
 *
 * After each debounced typegen pass (so `.kickjs/types` is fresh —
 * checking against stale typegen output would report false positives), the
 * dev server runs the PROJECT's own checker (`tsgo --noEmit`, falling
 * back to `tsc --noEmit`) as a detached child process and surfaces
 * diagnostics in the dev console + a `kickjs:typecheck` HMR event.
 *
 * tsgo checks a typical project in well under a second, so this is
 * cheap enough to run on every save — but it stays opt-in
 * (`--typecheck` flag or `dev.typecheck` in kick.config) because the
 * adopter may already have an IDE or separate watch doing the job.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface TypecheckBin {
  cmd: string
  args: string[]
  /** `.CMD` shims require a shell on Windows. */
  shell: boolean
  kind: 'tsgo' | 'tsc'
}

/**
 * Locate the project's checker binary under `node_modules/.bin`,
 * preferring tsgo (`@typescript/native-preview`) over tsc. Returns
 * null when neither is installed — callers print a one-time notice
 * and skip checking rather than failing the dev server.
 *
 * On Windows the runnable shim is `<name>.CMD` / `<name>.cmd`; the
 * extensionless file is a POSIX shell script `spawn` can't launch.
 */
export function resolveTypecheckBin(projectDir: string): TypecheckBin | null {
  const binDir = join(projectDir, 'node_modules', '.bin')
  const isWin = process.platform === 'win32'
  for (const kind of ['tsgo', 'tsc'] as const) {
    const names = isWin ? [`${kind}.CMD`, `${kind}.cmd`, `${kind}.exe`] : [kind]
    for (const name of names) {
      const candidate = join(binDir, name)
      if (existsSync(candidate)) {
        return { cmd: candidate, args: ['--noEmit'], shell: isWin, kind }
      }
    }
  }
  return null
}

export interface TypecheckResult {
  ok: boolean
  /** Combined stdout+stderr of the checker run. */
  output: string
  durationMs: number
  kind: 'tsgo' | 'tsc'
}

export interface DevTypechecker {
  /** Start a check, killing any in-flight run (its result is dropped). */
  schedule(): void
  /** Kill any in-flight run and stop reporting. */
  dispose(): void
}

export function createDevTypechecker(opts: {
  cwd: string
  bin: TypecheckBin
  onResult: (result: TypecheckResult) => void
  /** Injectable for tests — defaults to node:child_process spawn. */
  spawnFn?: typeof spawn
}): DevTypechecker {
  const spawnFn = opts.spawnFn ?? spawn
  let inflight: ChildProcess | null = null
  // Generation counter — a superseded or disposed run's `close` event
  // must not report (rapid saves would otherwise interleave stale
  // results over fresh ones).
  let generation = 0
  let disposed = false

  return {
    schedule() {
      if (disposed) return
      const myGen = ++generation
      if (inflight) {
        inflight.kill()
        inflight = null
      }
      const started = Date.now()
      const child = spawnFn(opts.bin.cmd, opts.bin.args, {
        cwd: opts.cwd,
        shell: opts.bin.shell,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      inflight = child
      let output = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })
      child.on('error', () => {
        // Spawn failure (binary vanished mid-session) — treat like a
        // superseded run; the resolve-time null path already covers
        // the "not installed" notice.
        if (myGen === generation) inflight = null
      })
      child.on('close', (code: number | null) => {
        if (disposed || myGen !== generation) return
        inflight = null
        opts.onResult({
          ok: code === 0,
          output,
          durationMs: Date.now() - started,
          kind: opts.bin.kind,
        })
      })
    },
    dispose() {
      disposed = true
      if (inflight) {
        inflight.kill()
        inflight = null
      }
    },
  }
}

/**
 * Compact a checker's diagnostic dump for the dev console — first
 * `maxLines` lines plus an overflow note. The full output always goes
 * out on the `kickjs:typecheck` HMR event for tools that want it.
 */
export function formatTypecheckOutput(output: string, maxLines = 12): string {
  const lines = output.trim().split(/\r?\n/)
  if (lines.length <= maxLines) return lines.join('\n')
  const shown = lines.slice(0, maxLines)
  return `${shown.join('\n')}\n… ${lines.length - maxLines} more line(s)`
}
