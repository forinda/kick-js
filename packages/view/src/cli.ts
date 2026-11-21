/**
 * `kick fmt:views` and `kick check:views`, as a kick CLI plugin:
 *
 * ```ts
 * // kick.config.ts
 * import { viewCliPlugin } from '@forinda/kickjs-view/cli'
 * export default defineConfig({ plugins: [viewCliPlugin] })
 * ```
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { KickCliPlugin } from '@forinda/kickjs-cli-kit'
import type { Diagnostic } from './diagnostics'
import { check } from './check/check'
import { splitName, type Project } from './check/project'
import { format } from './format'
import { allTemplates, loadViewsProject } from './load-project'
import { resolveViewRoots, viewsConfigOf, type ViewRoot } from './roots'
import { viewsTypegen } from './typegen'

export interface ViewsCliOptions {
  /** Project root. */
  root: string
  /** Views folder, relative to the root. Default `src/views`. */
  dir?: string
  /** Only these files (relative to the root). Default: every `.kick` file in the views folders. */
  paths?: string[]
  /** Named view roots (from kick.config's `views.roots`, via `resolveViewRoots`). */
  roots?: ViewRoot[]
  log: (message: string) => void
}

const line = (d: Diagnostic, prefix: string) =>
  `${prefix}${d.file}:${d.span.start.line}:${d.span.start.column} — ${d.message}`

/** Format templates in place, or with `check` report the ones that would change. Returns the exit code. */
export async function fmtViews(
  opts: ViewsCliOptions & { check?: boolean; indent?: number },
): Promise<number> {
  const dir = opts.dir ?? 'src/views'
  const viewsDir = resolve(opts.root, dir)
  // An installed package's templates aren't the app's to rewrite.
  const editable = (opts.roots ?? []).filter((r) => !r.readOnly)
  const dirs = new Map(editable.map((r) => [r.name, r.dir]))
  let failed = false
  let changed = 0
  for (const name of await allTemplates(viewsDir, opts.root, editable, opts.paths)) {
    const { root, path } = splitName(name)
    const file = join(root === undefined ? viewsDir : dirs.get(root)!, `${path}.kick`)
    const shown = relative(opts.root, file).split(sep).join('/')
    const source = await readFile(file, 'utf8')
    const r = format(source, shown, { indent: opts.indent })
    for (const d of r.diagnostics) opts.log(line(d, ''))
    if (r.output === undefined) {
      failed = true
      continue
    }
    if (r.output === source) continue
    changed++
    if (opts.check) opts.log(`would reformat ${shown}`)
    else {
      await writeFile(file, r.output)
      opts.log(`formatted ${shown}`)
    }
  }
  return failed || (opts.check && changed) ? 1 : 0
}

/** Parse and check every template; print each problem with its position. Returns the exit code. */
export async function checkViews(
  opts: ViewsCliOptions & {
    pipesFile?: string
    /** The app's browser validators. Default `<dir>/validators.ts`. */
    validatorsFile?: string
    componentsDir?: string
    layouts?: Project['layouts']
    baseLayout?: string
  },
): Promise<number> {
  const loaded = await loadViewsProject({ ...opts, pipesFile: opts.pipesFile })
  const { project, viewsDir, unparsed: syntax } = loaded
  let errors = 0
  const report = (d: Diagnostic, prefix: string) => {
    if (d.severity === 'error') errors++
    opts.log(line(d, prefix))
  }
  for (const { d, prefix } of loaded.diagnostics) report(d, prefix)
  const all = loaded.names
  const wanted = opts.paths?.length
    ? await allTemplates(viewsDir, opts.root, opts.roots, opts.paths)
    : all
  for (const name of wanted) {
    if (syntax.has(name)) continue
    for (const d of check(name, project).diagnostics) report(d, loaded.prefixOf(name))
  }
  if (!errors) opts.log(`${wanted.length} template(s) checked, no errors`)
  return errors ? 1 : 0
}

/** Where the app's views live, for the commands' defaults and the `kick/views` typegen. */
export interface KickViewsCliOptions {
  /** Views folder, relative to the project root. Default `src/views`. */
  dir?: string
  /** Components folder, inside the views folder. Default `components`. */
  componentsDir?: string
  /** Pipes file. Default `<dir>/pipes.ts`. */
  pipes?: string
  /** Validators file. Default `<dir>/validators.ts`. */
  validators?: string
}

/**
 * The view package's CLI plugin: `kick check:views`, `kick fmt:views`, and the
 * `kick/views` typegen that types `ctx.render` from your templates. Pass the
 * options when your views aren't in `src/views`:
 *
 * ```ts
 * // kick.config.ts
 * plugins: [kickViewsCli({ dir: 'app/views' })]
 * ```
 *
 * @see https://kickjs.app/guide/views/typed-render-data
 */
export function kickViewsCli(options: KickViewsCliOptions = {}): KickCliPlugin {
  return {
    name: 'kick/view',
    typegens: [viewsTypegen(options)],
    register(program, ctx) {
      const views = viewsConfigOf(ctx.config)
      // `kickViewsCli({ dir })` overrides kick.config's `views.dir`.
      const dir = options.dir ?? views?.dir ?? 'src/views'
      /** The roots, or `undefined` after logging why kick.config's are wrong. */
      const roots = (): ViewRoot[] | undefined => {
        try {
          return resolveViewRoots(ctx.projectRoot, views).roots
        } catch (err) {
          ctx.log((err as Error).message)
          return undefined
        }
      }
      program
        .command('fmt:views [paths...]')
        .description('Format .kick templates (spacing and indentation; raw regions untouched)')
        .option('--check', 'list files that would change and exit 1, writing nothing')
        .option('--dir <dir>', 'views folder', dir)
        .action(async (paths: string[], o: { check?: boolean; dir: string }) => {
          const r = roots()
          if (!r) return void (process.exitCode = 1)
          process.exitCode = await fmtViews({
            root: ctx.projectRoot,
            dir: o.dir,
            roots: r,
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
        .option('--dir <dir>', 'views folder', dir)
        .option('--pipes <file>', 'pipes file (default <dir>/pipes.ts)', options.pipes)
        .option(
          '--validators <file>',
          'validators file (default <dir>/validators.ts)',
          options.validators,
        )
        .action(
          async (paths: string[], o: { dir: string; pipes?: string; validators?: string }) => {
            const r = roots()
            if (!r) return void (process.exitCode = 1)
            process.exitCode = await checkViews({
              root: ctx.projectRoot,
              dir: o.dir,
              roots: r,
              paths,
              pipesFile: o.pipes,
              validatorsFile: o.validators,
              componentsDir: options.componentsDir,
              log: ctx.log,
            })
          },
        )
    },
  }
}

/** The plugin with default folders — `kickViewsCli()`. */
export const viewCliPlugin: KickCliPlugin = kickViewsCli()

export { readCatalogs } from './loaders/file'
export {
  packageDir,
  resolveViewRoots,
  rootFolders,
  viewsConfigOf,
  type ViewRoot,
  type ViewsConfig,
} from './roots'
