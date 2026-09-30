/**
 * `kick add` wiring — apply a package's scaffold layer to an existing app:
 * its packages join the install, its `.env` lines are added, and its adapter
 * is spliced into the entry file (see `scaffold/wire.ts`).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { writeFileSafe } from '../utils/fs'
import { renderLayers, type Integration, type RenderedProject } from '../scaffold/overlay'
import { wireIntegrations, type WireResult } from '../scaffold/wire'

/**
 * `kick add` names with a layer. `queue` means BullMQ, as it does in
 * `kick new`; `queue:rabbitmq` / `queue:kafka` pick another provider, which
 * the layer doesn't configure, so they install only.
 */
export const FEATURE_LAYERS: Record<string, string> = {
  swagger: 'feature-swagger',
  devtools: 'feature-devtools',
  ws: 'feature-ws',
  queue: 'feature-queue',
  'queue:bullmq': 'feature-queue',
}

/** The layers `packages` bring, rendered — or undefined when none has one. */
export function planWiring(packages: readonly string[]): RenderedProject | undefined {
  const layers = [...new Set(packages.map((name) => FEATURE_LAYERS[name]).filter(Boolean))]
  return layers.length > 0 ? renderLayers(layers as string[]) : undefined
}

/** The entry file to wire: `--entry`, else `src/index.ts` / `src/main.ts`. */
export function findEntry(cwd: string, entry?: string): string | undefined {
  const candidates = entry ? [entry] : ['src/index.ts', 'src/main.ts']
  return candidates.find((file) => existsSync(join(cwd, file)))
}

/**
 * Files among `files` with uncommitted changes. Outside a git repository
 * (or without git) nothing counts as dirty.
 */
export function dirtyFiles(cwd: string, files: readonly string[]): string[] {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', ...files], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3))
  } catch {
    return []
  }
}

/**
 * Write a layer's non-entry files. A file that exists only gains the lines it
 * doesn't already have (`.env` keeps its values); a missing one is created.
 * Returns the paths changed.
 */
export async function applyLayerFiles(
  cwd: string,
  files: ReadonlyMap<string, string>,
): Promise<string[]> {
  const changed: string[] = []
  for (const [path, contents] of files) {
    const abs = join(cwd, path)
    if (!existsSync(abs)) {
      await writeFileSafe(abs, contents)
      changed.push(path)
      continue
    }
    const current = readFileSync(abs, 'utf-8')
    const have = new Set(current.split('\n').map((line) => envKey(line) ?? line))
    const missing = contents
      .split('\n')
      .filter((line) => line.trim() && !have.has(envKey(line) ?? line))
    if (missing.length === 0) continue
    const sep = current === '' || current.endsWith('\n') ? '' : '\n'
    await writeFileSafe(abs, `${current}${sep}${missing.join('\n')}\n`)
    changed.push(path)
  }
  return changed
}

/** `REDIS_HOST` for `REDIS_HOST=…`, so an existing value counts as present. */
const envKey = (line: string) => /^\s*([A-Za-z_][\w]*)\s*=/.exec(line)?.[1]

/** Splice the integrations into the entry file and write it back when it changed. */
export async function wireEntry(
  cwd: string,
  entry: string,
  integrations: readonly Integration[],
): Promise<WireResult> {
  const abs = join(cwd, entry)
  const source = readFileSync(abs, 'utf-8')
  const result = wireIntegrations(source, integrations, projectVars(cwd), entry)
  if (result.source !== source) await writeFileSafe(abs, result.source)
  return result
}

/** Fill `{{name}}` / `{{version}}` from the project's package.json. */
export function projectVars(cwd: string): (text: string) => string {
  const pkg = readPackageJson(cwd)
  const vars: Record<string, string> = {
    name: String(pkg.name ?? 'app'),
    version: String(pkg.version ?? '0.0.0'),
  }
  return (text) => text.replace(/\{\{(\w+)\}\}/g, (all, key) => vars[key] ?? all)
}

function readPackageJson(cwd: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'))
  } catch {
    return {}
  }
}

/** What to paste by hand for entries that couldn't be placed. */
export function manualSnippet(entries: readonly Integration[]): string {
  const imports = entries
    .flatMap((e) => (e.import ? [e.import] : []))
    .map((spec) => {
      const parts = [spec.default, spec.names?.length ? `{ ${spec.names.join(', ')} }` : undefined]
      return `import ${parts.filter(Boolean).join(', ')} from '${spec.from}'`
    })
  const code = entries.map((e) => `${e.code},`)
  return [...imports, '', '// in bootstrap({ adapters: [ ... ] }):', ...code].join('\n')
}
