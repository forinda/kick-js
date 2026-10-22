/**
 * `kick fmt:views` and `kick check:views`, as a kick CLI plugin:
 *
 * ```ts
 * // kick.config.ts
 * import { viewCliPlugin } from '@forinda/kickjs-view/cli'
 * export default defineConfig({ plugins: [viewCliPlugin] })
 * ```
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { KickCliPlugin } from '@forinda/kickjs-cli-kit'
import type { Diagnostic } from './diagnostics'
import { check } from './check/check'
import type { Project } from './check/project'
import { format } from './format'
import { parse } from './parse/template'
import { BUILTIN_PIPES } from './pipes/builtins'
import { readPipeExports } from './pipes/read-exports'

export interface ViewsCliOptions {
  /** Project root. */
  root: string
  /** Views folder, relative to the root. Default `src/views`. */
  dir?: string
  /** Only these files (relative to the root). Default: every `.kick` file in the views folder. */
  paths?: string[]
  log: (message: string) => void
}

const line = (d: Diagnostic, prefix: string) =>
  `${prefix}${d.file}:${d.span.start.line}:${d.span.start.column} — ${d.message}`

/** Template names (`users/show`) under the views folder, or those `paths` name. */
async function templates(viewsDir: string, root: string, paths?: string[]): Promise<string[]> {
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

/** Format templates in place, or with `check` report the ones that would change. Returns the exit code. */
export async function fmtViews(
  opts: ViewsCliOptions & { check?: boolean; indent?: number },
): Promise<number> {
  const dir = opts.dir ?? 'src/views'
  const viewsDir = resolve(opts.root, dir)
  let failed = false
  let changed = 0
  for (const name of await templates(viewsDir, opts.root, opts.paths)) {
    const file = join(viewsDir, `${name}.kick`)
    const source = await readFile(file, 'utf8')
    const r = format(source, `${name}.kick`, { indent: opts.indent })
    for (const d of r.diagnostics) opts.log(line(d, `${dir}/`))
    if (r.output === undefined) {
      failed = true
      continue
    }
    if (r.output === source) continue
    changed++
    if (opts.check) opts.log(`would reformat ${dir}/${name}.kick`)
    else {
      await writeFile(file, r.output)
      opts.log(`formatted ${dir}/${name}.kick`)
    }
  }
  return failed || (opts.check && changed) ? 1 : 0
}

/** Parse and check every template; print each problem with its position. Returns the exit code. */
export async function checkViews(
  opts: ViewsCliOptions & {
    pipesFile?: string
    componentsDir?: string
    layouts?: Project['layouts']
    baseLayout?: string
  },
): Promise<number> {
  const dir = opts.dir ?? 'src/views'
  const viewsDir = resolve(opts.root, dir)
  const pipesFile = resolve(opts.root, opts.pipesFile ?? join(dir, 'pipes.ts'))
  const all = await templates(viewsDir, opts.root)
  const pipes = new Set(BUILTIN_PIPES)
  let errors = 0
  const report = (d: Diagnostic, prefix: string) => {
    if (d.severity === 'error') errors++
    opts.log(line(d, prefix))
  }
  if (existsSync(pipesFile)) {
    const read = readPipeExports(await readFile(pipesFile, 'utf8'), relative(opts.root, pipesFile))
    for (const n of read.names) pipes.add(n)
    for (const d of read.diagnostics) report(d, '')
  }
  const project: Project = {
    templates: new Map(),
    pipes,
    componentsDir: opts.componentsDir ?? 'components',
    layouts: opts.layouts,
    baseLayout: opts.baseLayout,
  }
  const syntax = new Set<string>()
  for (const name of all) {
    const r = parse(await readFile(join(viewsDir, `${name}.kick`), 'utf8'), `${name}.kick`)
    project.templates.set(name, r.ast)
    for (const d of r.diagnostics) report(d, `${dir}/`)
    if (r.diagnostics.some((d) => d.severity === 'error')) syntax.add(name)
  }
  const wanted = opts.paths?.length ? await templates(viewsDir, opts.root, opts.paths) : all
  for (const name of wanted) {
    if (syntax.has(name)) continue
    for (const d of check(name, project).diagnostics) report(d, `${dir}/`)
  }
  if (!errors) opts.log(`${wanted.length} template(s) checked, no errors`)
  return errors ? 1 : 0
}

export const viewCliPlugin: KickCliPlugin = {
  name: 'kick/view',
  register(program, ctx) {
    program
      .command('fmt:views [paths...]')
      .description('Format .kick templates (spacing and indentation; raw regions untouched)')
      .option('--check', 'list files that would change and exit 1, writing nothing')
      .option('--dir <dir>', 'views folder', 'src/views')
      .action(async (paths: string[], o: { check?: boolean; dir: string }) => {
        process.exitCode = await fmtViews({
          root: ctx.projectRoot,
          dir: o.dir,
          paths,
          check: o.check,
          log: ctx.log,
        })
      })
    program
      .command('check:views [paths...]')
      .description(
        'Check .kick templates for errors: syntax, unknown pipes, inputs, slots, layouts, unsafe interpolation',
      )
      .option('--dir <dir>', 'views folder', 'src/views')
      .option('--pipes <file>', 'pipes file (default <dir>/pipes.ts)')
      .action(async (paths: string[], o: { dir: string; pipes?: string }) => {
        process.exitCode = await checkViews({
          root: ctx.projectRoot,
          dir: o.dir,
          paths,
          pipesFile: o.pipes,
          log: ctx.log,
        })
      })
  },
}

/** A dirent's folder: `parentPath` from Node 20.12, `path` before it. */
function direntDir(e: { parentPath?: string; path?: string }): string {
  return e.parentPath ?? e.path ?? ''
}
