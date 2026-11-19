import type { TemplateAst } from '../ast'

/** Everything `check` knows about an app's views — built the same way by the runtime, the build and the editor. */
export interface Project {
  /** Template name (`users/show`, `components/user-card`) → its parsed source. */
  templates: Map<string, TemplateAst>
  /** Pipe names: the built-ins and the app's. */
  pipes: Set<string>
  /** The app's validator names, from `validators.ts` (the built-ins are always known). */
  validators?: Set<string>
  /** Folder (inside the views folder) holding components. Default `components`. */
  componentsDir: string
  /** A page's layout when it declares none: one name, or folder prefix → layout. */
  layouts?: string | Record<string, string>
  /** The shell around every page's outermost layout. */
  baseLayout?: string
}

/**
 * The layout for a page that declares none. A map's longest matching folder
 * prefix wins: `{ admin: 'layouts/admin', '': 'layouts/main' }` gives
 * `admin/users` the admin layout and everything else the main one.
 */
export function layoutResolver(
  layouts?: string | Record<string, string>,
): (page: string) => string | undefined {
  if (layouts === undefined) return () => undefined
  if (typeof layouts === 'string') return () => layouts
  const prefixes = Object.keys(layouts).toSorted((a, b) => b.length - a.length)
  return (page) => {
    const hit = prefixes.find((p) => p === '' || page === p || page.startsWith(`${p}/`))
    return hit === undefined ? undefined : layouts[hit]
  }
}

/** Templates that are layouts by configuration — they never get a mapped layout themselves. */
export function configuredLayouts(project: Project): Set<string> {
  const names = new Set<string>()
  if (typeof project.layouts === 'string') names.add(project.layouts)
  else if (project.layouts) for (const v of Object.values(project.layouts)) names.add(v)
  if (project.baseLayout) names.add(project.baseLayout)
  return names
}

const SEGMENT = /^[A-Za-z0-9_-]+$/
/** A view root's name: `billing`, `acme-ui`. */
export const ROOT_NAME = /^[a-z][a-z0-9-]*$/

/** `billing::invoices/show` → root `billing`, path `invoices/show`; an app template has no root. */
export function splitName(name: string): { root?: string; path: string } {
  const at = name.indexOf('::')
  return at < 0 ? { path: name } : { root: name.slice(0, at), path: name.slice(at + 2) }
}

/** The full name of `path` in `root` (the app's own when `root` is undefined). */
export const qualify = (root: string | undefined, path: string): string =>
  root === undefined ? path : `${root}::${path}`

/**
 * A valid template name, or `undefined`: `/`-joined segments, no `..`, no
 * extension, no absolute path; optionally after a view root (`billing::`).
 */
export function templateName(name: string): string | undefined {
  if (typeof name !== 'string' || !name) return undefined
  const { root, path } = splitName(name)
  if (root !== undefined && !ROOT_NAME.test(root)) return undefined
  if (!path) return undefined
  const segments = path.split('/')
  return segments.every((s) => SEGMENT.test(s)) ? name : undefined
}

/**
 * What `ref`, written in template `from`, names: a qualified `ref` as is; an
 * unqualified one in `from`'s own root when that has it, else the app's.
 */
export function resolveRef(from: string, ref: string, has: (name: string) => boolean): string {
  if (ref.includes('::')) return ref
  const { root } = splitName(from)
  if (root === undefined) return ref
  const own = qualify(root, ref)
  return has(own) ? own : ref
}

/**
 * `components/forms/text-field` → `forms-text-field`; a root's component
 * starts with the root (`ui::components/button` → `ui-button`): custom
 * element names are global in the browser.
 */
export function componentTag(name: string, componentsDir: string): string {
  const { root, path } = splitName(name)
  const tag = path
    .slice(componentsDir.length + 1)
    .split('/')
    .join('-')
    .toLowerCase()
  return root === undefined ? tag : `${root}-${tag}`
}

export const isComponent = (name: string, componentsDir: string): boolean =>
  splitName(name).path.startsWith(`${componentsDir}/`)
