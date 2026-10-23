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

/** A valid template name, or `undefined`: `/`-joined segments, no `..`, no extension, no absolute path. */
export function templateName(name: string): string | undefined {
  if (typeof name !== 'string' || !name) return undefined
  const segments = name.split('/')
  return segments.every((s) => SEGMENT.test(s)) ? name : undefined
}

/** `components/forms/text-field` → `forms-text-field`. */
export function componentTag(name: string, componentsDir: string): string {
  return name
    .slice(componentsDir.length + 1)
    .split('/')
    .join('-')
    .toLowerCase()
}

export const isComponent = (name: string, componentsDir: string): boolean =>
  name.startsWith(`${componentsDir}/`)
