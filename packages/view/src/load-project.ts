/**
 * Reading an app's views from disk — templates, pipe and validator names —
 * the way `kick check:views` and the `kick/views` typegen both need it.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { Diagnostic } from './diagnostics'
import { qualify, splitName, type Project } from './check/project'
import type { ViewRoot } from './roots'
import { parse } from './parse/template'
import { BUILTIN_PIPES } from './pipes/builtins'
import { readPipeExports } from './pipes/read-exports'
import { readValidatorExports } from './validators'

/** Template names under `viewsDir` (or just `paths`, relative to the root), `/`-separated, sorted. */
export async function templates(
  viewsDir: string,
  root: string,
  paths?: string[],
): Promise<string[]> {
  if (paths?.length) {
    return paths
      .map((p) => relative(viewsDir, resolve(root, p)))
      .filter((p) => p.endsWith('.kick') && !p.startsWith('..'))
      .map((p) => p.slice(0, -'.kick'.length).split(sep).join('/'))
  }
  if (!existsSync(viewsDir)) return []
  const entries = await readdir(viewsDir, { recursive: true, withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.kick'))
    .map((e) =>
      relative(viewsDir, join(direntDir(e), e.name))
        .slice(0, -'.kick'.length)
        .split(sep)
        .join('/'),
    )
    .toSorted()
}

/** `Dirent.parentPath` (Node 20.12+), or the older `path`. */
function direntDir(e: { parentPath?: string; path?: string }): string {
  return e.parentPath ?? e.path ?? ''
}

/** Where an app's views live, relative to its root. */
export interface ViewsLocation {
  root: string
  /** Default `src/views`. */
  dir?: string
  /** Default `components`, inside the views folder. */
  componentsDir?: string
  /** Default `<dir>/pipes.ts`. */
  pipesFile?: string
  /** Default `<dir>/validators.ts`. */
  validatorsFile?: string
  layouts?: Project['layouts']
  baseLayout?: string
  /** Named view roots (`billing::…`), resolved by `resolveViewRoots`. */
  roots?: ViewRoot[]
}

/** Template names under the app folder and every root, qualified (`billing::x`); `paths` limits them. */
export async function allTemplates(
  viewsDir: string,
  root: string,
  roots: ViewRoot[] = [],
  paths?: string[],
): Promise<string[]> {
  const out = await templates(viewsDir, root, paths)
  for (const r of roots) {
    for (const name of await templates(r.dir, root, paths)) out.push(qualify(r.name, name))
  }
  return out
}

/** Every template parsed, with the app's pipe and validator names — ready for `check`. */
export async function loadViewsProject(loc: ViewsLocation): Promise<{
  project: Project
  dir: string
  viewsDir: string
  names: string[]
  /** Problems reading pipes.ts / validators.ts (no prefix) and parse errors (`<dir>/` prefix). */
  diagnostics: Array<{ d: Diagnostic; prefix: string }>
  /** Templates that didn't parse: `check` would only repeat the errors. */
  unparsed: Set<string>
  /** Where template `name` lives, relative to the project root (`/`-separated). */
  fileOf: (name: string) => string
  /** What goes before a diagnostic's file: `<dir>/` for the app's templates, nothing for a root's (its file is already a project path). */
  prefixOf: (name: string) => string
}> {
  const dir = loc.dir ?? 'src/views'
  const viewsDir = resolve(loc.root, dir)
  const pipesFile = resolve(loc.root, loc.pipesFile ?? join(dir, 'pipes.ts'))
  const validatorsFile = resolve(loc.root, loc.validatorsFile ?? join(dir, 'validators.ts'))
  const diagnostics: Array<{ d: Diagnostic; prefix: string }> = []
  const pipes = new Set(BUILTIN_PIPES)
  if (existsSync(pipesFile)) {
    const read = readPipeExports(await readFile(pipesFile, 'utf8'), relative(loc.root, pipesFile))
    for (const n of read.names) pipes.add(n)
    for (const d of read.diagnostics) diagnostics.push({ d, prefix: '' })
  }
  const validators = new Set<string>()
  if (existsSync(validatorsFile)) {
    const read = readValidatorExports(
      await readFile(validatorsFile, 'utf8'),
      relative(loc.root, validatorsFile),
    )
    for (const n of read.names) validators.add(n)
    for (const d of read.diagnostics) diagnostics.push({ d, prefix: '' })
  }
  const project: Project = {
    templates: new Map(),
    pipes,
    validators,
    componentsDir: loc.componentsDir ?? 'components',
    layouts: loc.layouts,
    baseLayout: loc.baseLayout,
  }
  const rootDirs = new Map((loc.roots ?? []).map((r) => [r.name, r.dir]))
  const absOf = (name: string) => {
    const { root, path } = splitName(name)
    return join(root === undefined ? viewsDir : rootDirs.get(root)!, `${path}.kick`)
  }
  const fileOf = (name: string) => relative(loc.root, absOf(name)).split(sep).join('/')
  const prefixOf = (name: string) => (splitName(name).root === undefined ? `${dir}/` : '')
  const names = await allTemplates(viewsDir, loc.root, loc.roots)
  const unparsed = new Set<string>()
  for (const name of names) {
    // A root's template is labelled by its project path; the app's keep `<name>.kick`.
    const label = splitName(name).root === undefined ? `${name}.kick` : fileOf(name)
    const r = parse(await readFile(absOf(name), 'utf8'), label)
    project.templates.set(name, r.ast)
    for (const d of r.diagnostics) diagnostics.push({ d, prefix: prefixOf(name) })
    if (r.diagnostics.some((d) => d.severity === 'error')) unparsed.add(name)
  }
  return { project, dir, viewsDir, names, diagnostics, unparsed, fileOf, prefixOf }
}
