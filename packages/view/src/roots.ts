/**
 * Named view roots: kick.config's `views` block turned into the folders the
 * runtime, the Vite plugin, the CLI and the editor all read.
 *
 * ```ts
 * views: {
 *   dir: 'src/views',
 *   roots: { billing: './src/modules/billing/views', ui: '@acme/kick-ui' },
 * }
 * ```
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { ROOT_NAME } from './check/project'

/** kick.config's `views` block. */
export interface ViewsConfig {
  /** The app's own templates. Default `src/views`. */
  dir?: string
  /**
   * More folders, by name: `billing::invoices/show`. A value starting with
   * `.` or `/` is a folder; otherwise an installed package (its package.json
   * `"kick": { "views": "views" }`), else a folder.
   */
  roots?: Record<string, string>
}

/** A view root, resolved. */
export interface ViewRoot {
  name: string
  /** Absolute. */
  dir: string
  /** Inside `node_modules` (an installed package): not watched or formatted. */
  readOnly: boolean
}

/** Where package `pkg` is installed for the project at `root`, looking up the folders as Node does. */
export function packageDir(root: string, pkg: string): string | undefined {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const at = join(dir, 'node_modules', pkg)
    if (existsSync(join(at, 'package.json'))) return at
    if (dirname(dir) === dir) return undefined
  }
}

/** The app's views folder and its named roots; `projectRoot` holds kick.config.ts. Throws on a bad root. */
export function resolveViewRoots(
  projectRoot: string,
  views: ViewsConfig = {},
): { dir: string; roots: ViewRoot[] } {
  const roots = Object.entries(views.roots ?? {}).map(([name, value]): ViewRoot => {
    if (!ROOT_NAME.test(name)) {
      throw new Error(
        `views.roots: '${name}' isn't a valid root name (lowercase letters, digits and -, starting with a letter)`,
      )
    }
    const dir = rootDir(projectRoot, name, value)
    if (!existsSync(dir)) throw new Error(`views.roots.${name}: no folder at ${dir}`)
    return { name, dir, readOnly: realpathSync(dir).split(sep).includes('node_modules') }
  })
  return { dir: resolve(projectRoot, views.dir ?? 'src/views'), roots }
}

function rootDir(projectRoot: string, name: string, value: string): string {
  if (value.startsWith('.') || value.startsWith('/')) return resolve(projectRoot, value)
  const pkg = packageDir(projectRoot, value)
  if (!pkg) return resolve(projectRoot, value)
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')) as {
    kick?: { views?: unknown }
  }
  const views = manifest.kick?.views
  if (typeof views !== 'string') {
    throw new Error(
      `views.roots.${name}: package ${value} has no "kick": { "views": "<folder>" } (kick.views) in its package.json`,
    )
  }
  return resolve(pkg, views)
}

/** kick.config's `views` block, if the config has one. */
export const viewsConfigOf = (config: unknown): ViewsConfig | undefined =>
  (config as { views?: ViewsConfig } | null | undefined)?.views

/** For `createViews({ roots })`: name → absolute folder. */
export function rootFolders(roots: ViewRoot[]): Record<string, string> {
  return Object.fromEntries(roots.map((r) => [r.name, r.dir]))
}
