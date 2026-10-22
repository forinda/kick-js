import type { TemplateAst } from '../ast'

/** Everything `check` knows about an app's views — built the same way by the runtime, the build and the editor. */
export interface Project {
  /** Template name (`users/show`, `components/user-card`) → its parsed source. */
  templates: Map<string, TemplateAst>
  /** Pipe names: the built-ins and the app's. */
  pipes: Set<string>
  /** Folder (inside the views folder) holding components. Default `components`. */
  componentsDir: string
  defaultLayout?: string
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
