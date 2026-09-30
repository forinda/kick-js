/**
 * Overlay scaffolding — project files as real directories instead of TS
 * functions that return strings.
 *
 * A layer is a directory under `packages/cli/templates/`:
 *
 * - `files/` mirrors the project. Layers render in order; a later layer's
 *   file replaces an earlier one at the same path, and a `<name>.append` file
 *   is added to the end of `<name>` instead.
 * - `feature.json` (optional) lists the packages the layer needs and its
 *   **integrations**: entries for the slots that shared files expose.
 *
 * File names: a `_dot_` path segment prefix becomes `.` (`_dot_gitignore` →
 * `.gitignore`), because npm publish drops or rewrites real dotfiles.
 *
 * Slots: a shared file marks where layers plug in with a comment line.
 * `// @kick:imports` becomes the merged import statements of every rendered
 * integration; `// @kick:<slot>` becomes that slot's entries, one `code,` per
 * line at the marker's indentation. An empty slot inside its own `key: [` …
 * `],` block drops the whole block, so an app with no adapters has no
 * `adapters: []`. This is what keeps layers out of each other's way: swagger
 * never edits the entry file, it declares an `adapter` entry.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * `packages/cli/templates` — one level above the bundle (`dist/*.mjs`), two
 * above this source file (`src/scaffold/overlay.ts`), so tests can import it
 * from source.
 */
export const TEMPLATES_DIR = [
  join(here, '..', 'templates'),
  join(here, '..', '..', 'templates'),
].find((dir) => existsSync(join(dir, 'base')))!

/** An import an integration needs. Merged per module across integrations. */
export interface ImportSpec {
  from: string
  names?: string[]
  default?: string
}

/**
 * What a layer contributes to shared files. With a `slot`, `code` is
 * rendered there and `import` only when that slot exists in the file — so an
 * `express.json()` middleware doesn't leave an unused `express` import in a
 * template without a middleware list. Without a `slot`, `import` is always
 * rendered.
 */
export interface Integration {
  import?: ImportSpec
  slot?: string
  code?: string
}

/** `feature.json`. Package versions come from the scaffold's resolved version map. */
export interface FeatureManifest {
  dependencies?: string[]
  devDependencies?: string[]
  /** Install-script answers for packages this layer pulls in (see `approveInstallScripts`). */
  builds?: Record<string, boolean>
  integrations?: Integration[]
}

export interface RenderedProject {
  files: Map<string, string>
  dependencies: string[]
  devDependencies: string[]
  builds: Record<string, boolean>
  /** Every layer's integrations plus `extra`, in layer order — `kick add` wires these. */
  integrations: Integration[]
}

/** The project path a template file lands at: `_dot_` segment prefixes become `.`. */
export function outputPath(templatePath: string): string {
  return templatePath
    .split('/')
    .map((segment) => (segment.startsWith('_dot_') ? `.${segment.slice(5)}` : segment))
    .join('/')
}

/**
 * Render layers into project files plus the packages they need. Pure apart
 * from reading the template directories; the caller writes the files.
 *
 * `extra` adds integrations computed at scaffold time (a value the user
 * typed can't live in a static layer). `vars` fills `{{name}}` in
 * integration code.
 */
export function renderLayers(
  layers: readonly string[],
  options: {
    templatesDir?: string
    extra?: Integration[]
    vars?: Record<string, string>
  } = {},
): RenderedProject {
  const templatesDir = options.templatesDir ?? TEMPLATES_DIR
  const files = new Map<string, string>()
  const dependencies: string[] = []
  const devDependencies: string[] = []
  const builds: Record<string, boolean> = {}
  const integrations: Integration[] = []

  for (const layer of layers) {
    const dir = join(templatesDir, layer)
    if (!existsSync(dir)) throw new Error(`Unknown scaffold layer "${layer}" (${dir})`)

    const manifestPath = join(dir, 'feature.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as FeatureManifest
      dependencies.push(...(manifest.dependencies ?? []))
      devDependencies.push(...(manifest.devDependencies ?? []))
      Object.assign(builds, manifest.builds)
      integrations.push(...(manifest.integrations ?? []))
    }

    const root = join(dir, 'files')
    if (!existsSync(root)) continue
    // String entries, not Dirents: `Dirent.parentPath` needs Node 20.12.
    for (const rel of readdirSync(root, { recursive: true, encoding: 'utf-8' }).toSorted()) {
      const abs = join(root, rel)
      if (!statSync(abs).isFile()) continue
      const contents = readFileSync(abs, 'utf-8')
      const path = outputPath(rel.split(sep).join('/'))
      if (path.endsWith('.append')) {
        const target = path.slice(0, -'.append'.length)
        files.set(target, (files.get(target) ?? '') + contents)
      } else {
        files.set(path, contents)
      }
    }
  }

  integrations.push(...(options.extra ?? []))
  const vars = options.vars ?? {}
  const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (all, key) => vars[key] ?? all)
  for (const [path, contents] of files) {
    if (contents.includes('// @kick:')) files.set(path, renderSlots(contents, integrations, fill))
  }

  return {
    files,
    dependencies: [...new Set(dependencies)],
    devDependencies: [...new Set(devDependencies)],
    builds,
    integrations,
  }
}

const MARKER = /^([ \t]*)\/\/ @kick:([\w-]+)[ \t]*$/

/** Fill one file's slot markers. */
export function renderSlots(
  source: string,
  integrations: readonly Integration[],
  fill: (text: string) => string = (text) => text,
): string {
  const lines = source.split('\n')
  const slots = new Set(lines.map((line) => MARKER.exec(line)?.[2]).filter(Boolean))
  const active = integrations.filter((i) => !i.slot || slots.has(i.slot))

  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = MARKER.exec(lines[i]!)
    if (!match) {
      out.push(lines[i]!)
      continue
    }
    const [, indent, slot] = match as unknown as [string, string, string]
    const rendered =
      slot === 'imports'
        ? renderImports(active.flatMap((entry) => (entry.import ? [entry.import] : [])))
        : active
            .filter((entry) => entry.slot === slot && entry.code)
            .map((entry) => indentBlock(`${fill(entry.code!)},`, indent))
    if (rendered.length > 0) {
      out.push(...rendered)
      continue
    }
    // Empty: drop an enclosing `key: [` … `],` block that holds only this marker.
    const prev = out.at(-1)
    if (prev?.trimEnd().endsWith('[') && lines[i + 1]?.trim().startsWith(']')) {
      out.pop()
      i++
    }
  }
  return out.join('\n')
}

function indentBlock(code: string, indent: string): string {
  return code
    .split('\n')
    .map((line) => (line ? indent + line : line))
    .join('\n')
}

/** One statement per module, names merged in first-seen order; wrapped past 100 columns. */
export function renderImports(specs: readonly ImportSpec[]): string[] {
  const byModule = new Map<string, { names: string[]; default?: string }>()
  for (const spec of specs) {
    const entry = byModule.get(spec.from) ?? { names: [] }
    entry.default ??= spec.default
    for (const name of spec.names ?? []) if (!entry.names.includes(name)) entry.names.push(name)
    byModule.set(spec.from, entry)
  }
  return [...byModule].map(([from, { names, default: def }]) => {
    const parts = [def, names.length ? `{ ${names.join(', ')} }` : undefined].filter(Boolean)
    const line = `import ${parts.join(', ')} from '${from}'`
    if (line.length <= 100 || names.length === 0) return line
    const head = def ? `${def}, ` : ''
    return `import ${head}{\n${names.map((n) => `  ${n},`).join('\n')}\n} from '${from}'`
  })
}
