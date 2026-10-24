/**
 * `kick add` wiring — apply a package's scaffold layer to an existing app:
 * its packages join the install, its `.env` lines are added, and its adapter
 * is spliced into the entry file (see `scaffold/wire.ts`).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

import { writeFileSafe } from '../utils/fs'
import { renderLayers, type Integration, type RenderedProject } from '../scaffold/overlay'
import { wireEnvSchema, wireIntegrations, type WireResult } from '../scaffold/wire'

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
  storage: 'feature-storage',
  views: 'feature-views',
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
 * Tracked files among `files` whose working copy differs from the index —
 * edits `git diff` would mix with kick add's. Untracked files (a fresh
 * `kick new`, before its first commit or inside a parent repo) and staged
 * changes don't count: kick add's edits still show as their own diff.
 * Outside a git repository (or without git) nothing counts as dirty.
 */
export function dirtyFiles(cwd: string, files: readonly string[]): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '--modified', '--', ...files], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return [...new Set(out.split('\n').filter(Boolean))]
  } catch {
    return []
  }
}

/** The env schema file: `src/config/index.ts` (what `kick new` writes), else an older `src/env.ts`. */
export function findEnvSchema(cwd: string): string | undefined {
  return ['src/config/index.ts', 'src/env.ts'].find((file) => existsSync(join(cwd, file)))
}

/** Add the layers' env keys to the schema in `file` and write it back when it changed. */
export async function wireEnv(
  cwd: string,
  file: string,
  integrations: readonly Integration[],
): Promise<WireResult> {
  const abs = join(cwd, file)
  const source = readFileSync(abs, 'utf-8')
  const result = wireEnvSchema(source, integrations, file)
  if (result.source !== source) await writeFileSafe(abs, result.source)
  return result
}

/**
 * Source files and templates: never merged line by line — appending a module
 * duplicates its declarations, and appending to a `.kick` template breaks it.
 */
const SOURCE = /\.(?:[cm]?[jt]sx?|kick)$/

/**
 * A layer's source files that already exist with other contents — the app's
 * own `src/adapters/storage.ts`, say. They're left alone, and what imports them isn't
 * wired: merging is the user's call.
 */
export function sourceFilesInTheWay(cwd: string, files: ReadonlyMap<string, string>): string[] {
  return [...files]
    .filter(([path, contents]) => {
      const abs = join(cwd, path)
      return SOURCE.test(path) && existsSync(abs) && readFileSync(abs, 'utf-8') !== contents
    })
    .map(([path]) => path)
}

/**
 * Write a layer's non-entry files. A missing one is created. An existing one
 * only gains the lines it doesn't already have (`.env` keeps its values) —
 * except a source file, which is left as it is (see {@link sourceFilesInTheWay}).
 * Returns the paths created and the existing ones that changed.
 */
export async function applyLayerFiles(
  cwd: string,
  files: ReadonlyMap<string, string>,
): Promise<{ created: string[]; updated: string[] }> {
  const created: string[] = []
  const updated: string[] = []
  for (const [path, contents] of files) {
    const abs = join(cwd, path)
    if (!existsSync(abs)) {
      await writeFileSafe(abs, contents)
      created.push(path)
      continue
    }
    if (SOURCE.test(path)) continue
    const current = readFileSync(abs, 'utf-8')
    const have = new Set(current.split('\n').map((line) => envKey(line) ?? line))
    const missing = contents
      .split('\n')
      .filter((line) => line.trim() && !have.has(envKey(line) ?? line))
    if (missing.length === 0) continue
    const sep = current === '' || current.endsWith('\n') ? '' : '\n'
    await writeFileSafe(abs, `${current}${sep}${missing.join('\n')}\n`)
    updated.push(path)
  }
  return { created, updated }
}

/**
 * Whether an integration imports one of `paths` (relative to the entry):
 * `./adapters/storage` from `src/index.ts` is `src/adapters/storage.ts`.
 */
export function importsAny(
  integration: Integration,
  entry: string,
  paths: readonly string[],
): boolean {
  const from = integration.import?.from
  if (!from?.startsWith('.')) return false
  const target = posix.join(posix.dirname(entry.replaceAll('\\', '/')), from)
  return paths.some((path) => path.replace(SOURCE, '') === target)
}

/**
 * Layers write their imports for `src/index.ts` (`./adapters/queue`); point
 * them at the same files from `entry` — `../adapters/queue` from `src/app/index.ts`.
 */
export function rebaseImports(integrations: readonly Integration[], entry: string): Integration[] {
  const dir = posix.dirname(entry.replaceAll('\\', '/'))
  return integrations.map((integration) => {
    const from = integration.import?.from
    if (!from?.startsWith('.')) return integration
    const path = posix.relative(dir, posix.join('src', from))
    return {
      ...integration,
      import: { ...integration.import!, from: path.startsWith('.') ? path : `./${path}` },
    }
  })
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

/**
 * What to add to kick.config.ts for a layer's CLI plugins (`config-plugin`
 * entries): `kick add` edits only the entry file. Undefined when there are none,
 * or when `config` (kick.config.ts's source) already names each of them.
 */
export function configSnippet(
  integrations: readonly Integration[],
  config = '',
): string | undefined {
  const plugins = integrations.filter(
    (i) =>
      i.slot === 'config-plugin' &&
      i.code &&
      !new RegExp(`\\b${i.code.split('\n').at(-1)!.trim()}\\b`).test(config),
  )
  if (!plugins.length) return undefined
  const imports = plugins.flatMap((i) =>
    i.import?.names?.length
      ? [`import { ${i.import.names.join(', ')} } from '${i.import.from}'`]
      : [],
  )
  const names = plugins.map((i) => i.code!.split('\n').at(-1)!.trim())
  return [...imports, '', `// in defineConfig({ ... }):`, `plugins: [${names.join(', ')}],`].join(
    '\n',
  )
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
