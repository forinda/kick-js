/**
 * Reading an app's views from disk — templates, pipe and validator names —
 * the way `kick check:views` and the `kick/views` typegen both need it.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { Diagnostic } from './diagnostics'
import type { Project } from './check/project'
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
  const names = await templates(viewsDir, loc.root)
  const unparsed = new Set<string>()
  for (const name of names) {
    const r = parse(await readFile(join(viewsDir, `${name}.kick`), 'utf8'), `${name}.kick`)
    project.templates.set(name, r.ast)
    for (const d of r.diagnostics) diagnostics.push({ d, prefix: `${dir}/` })
    if (r.diagnostics.some((d) => d.severity === 'error')) unparsed.add(name)
  }
  return { project, dir, viewsDir, names, diagnostics, unparsed }
}
