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
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

export interface TypecheckBin {
  cmd: string
  args: string[]
  /** `.CMD` shims require a shell on Windows. */
  shell: boolean
  kind: 'vue-tsc' | 'tsgo' | 'tsc'
}

/**
 * Locate the project's checker binary under `node_modules/.bin`,
 * preferring tsgo (`@typescript/native-preview`) over tsc. Returns
 * null when none is installed — callers print a one-time notice
 * and skip checking rather than failing the dev server.
 *
 * On Windows the runnable shim is `<name>.CMD` / `<name>.cmd`; the
 * extensionless file is a POSIX shell script `spawn` can't launch.
 */
export function resolveTypecheckBin(projectDir: string): TypecheckBin | null {
  const isWin = process.platform === 'win32'
  for (const binDir of localBinDirs(projectDir)) {
    // `vue-tsc` first, and it being installed is the signal: plain tsc does not
    // understand `.vue`, so in a Vue project it matches no inputs and reports
    // TS18003 "No inputs were found" while real errors sit unchecked in the
    // SFCs. vue-tsc checks plain `.ts` too, so preferring it costs nothing.
    for (const kind of ['vue-tsc', 'tsgo', 'tsc'] as const) {
      const names = isWin ? [`${kind}.CMD`, `${kind}.cmd`, `${kind}.exe`] : [kind]
      for (const name of names) {
        const candidate = join(binDir, name)
        if (existsSync(candidate)) {
          return { cmd: candidate, args: ['--noEmit'], shell: isWin, kind }
        }
      }
    }
  }
  return null
}

/**
 * The `node_modules/.bin` folders whose tools are this project's: its own,
 * then its workspace root's — npm, yarn and bun install a workspace package's
 * tools there. No further up: a binary in some parent folder is not ours to run.
 */
export function localBinDirs(projectDir: string): string[] {
  const project = resolve(projectDir)
  const root = workspaceRoot(project)
  return (root ? [project, root] : [project]).map((dir) => join(dir, 'node_modules', '.bin'))
}

/**
 * The workspace root `dir` belongs to: the first folder above it with a
 * `package.json` or `pnpm-workspace.yaml`, and only when that file lists `dir`
 * as a member. Anything else above — a stray `package.json` in `/tmp` — is not
 * this project's, and nothing further up is searched.
 */
function workspaceRoot(dir: string): string | undefined {
  for (let up = dirname(dir); up !== dirname(up); up = dirname(up)) {
    const pnpmFile = join(up, 'pnpm-workspace.yaml')
    const pkgFile = join(up, 'package.json')
    if (!existsSync(pnpmFile) && !existsSync(pkgFile)) continue
    return workspaceMembers(pnpmFile, pkgFile).some((glob) => globMatch(glob, relative(up, dir)))
      ? up
      : undefined
  }
  return undefined
}

/** Member globs from `pnpm-workspace.yaml`'s `packages:` or package.json's `workspaces`. */
function workspaceMembers(pnpmFile: string, pkgFile: string): string[] {
  try {
    if (existsSync(pnpmFile)) {
      // The list right under `packages:`, up to the next key.
      const after = readFileSync(pnpmFile, 'utf-8').split(/^packages:\s*$/m)[1] ?? ''
      const globs: string[] = []
      for (const line of after.split('\n')) {
        if (!line.trim() || line.trim().startsWith('#')) continue
        const item = /^\s+-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line)
        if (!item) break
        globs.push(item[1]!)
      }
      return globs
    }
    const { workspaces } = JSON.parse(readFileSync(pkgFile, 'utf-8'))
    const globs = Array.isArray(workspaces) ? workspaces : workspaces?.packages
    return Array.isArray(globs) ? globs.filter((g): g is string => typeof g === 'string') : []
  } catch {
    return []
  }
}

/** Workspace globs: `*` is one path segment, `**` any depth. No negation. */
function globMatch(glob: string, path: string): boolean {
  const pattern = glob
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .split('/')
    .map((part) =>
      part === '**' ? '.*' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'),
    )
    .join('/')
  return new RegExp(`^${pattern}$`).test(path.split(sep).join('/'))
}

export interface TypecheckResult {
  ok: boolean
  /** Combined stdout+stderr of the checker run. */
  output: string
  durationMs: number
  kind: 'vue-tsc' | 'tsgo' | 'tsc'
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
