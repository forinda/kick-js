/**
 * Find references and rename for the names templates share: component tags,
 * layout names and pipes. Renaming a component or layout renames its file
 * too; renaming the file in the editor updates its uses (`fileRenameEdits`).
 */
import type { Location, Range, TextEdit, WorkspaceEdit } from '@volar/language-service'
import { URI } from 'vscode-uri'
import type { Workspace } from '../workspace'
import { componentOf } from './completion'
import { posOf } from './hover'
import { calls } from './render-calls'
import { kickTokens } from './tokens'

type Target =
  | { kind: 'component'; name: string; tag: string }
  | { kind: 'layout'; name: string }
  | { kind: 'pipe'; name: string }

interface Use {
  uri: string
  /** The template it's in, and the name as written there (a layout's). */
  from: string
  written: string
  text: string
  offset: number
  length: number
}

const TOP = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
const IDENT = /^[A-Za-z_$][\w$]*$/
const LAYOUT = /@layout\s*\(\s*(['"])([^'"]*)\1/g

const rangeOf = (text: string, offset: number, length: number): Range => ({
  start: posOf(text, offset),
  end: posOf(text, offset + length),
})

/** `ui::layouts/main` → `ui`; an app template has none. */
const rootOf = (name: string) =>
  name.includes('::') ? name.slice(0, name.indexOf('::')) : undefined

/**
 * What to write for a layout renamed to `newFull`, at a use written as
 * `written` in template `from`: unqualified when it stays in that root.
 */
function layoutText(ws: Workspace, use: Use, newFull: string): string {
  const root = rootOf(newFull)
  return !use.written.includes('::') && root !== undefined && rootOf(use.from) === root
    ? ws.pathPart(newFull)
    : newFull
}

/** The shared name under the cursor, with where it sits in `text` (the template at `uri`). */
function targetAt(
  ws: Workspace,
  text: string,
  offset: number,
  uri?: string,
): { target: Target; offset: number; length: number } | undefined {
  const tokens = kickTokens(text, (tag) => componentOf(ws, tag) !== undefined)
  const t = tokens.find((k) => offset >= k.offset && offset <= k.offset + k.length)
  if (!t) return undefined
  const word = text.slice(t.offset, t.offset + t.length)
  if (t.type === 'class') {
    const name = componentOf(ws, word.toLowerCase())
    return name === undefined
      ? undefined
      : { target: { kind: 'component', name, tag: word.toLowerCase() }, ...t }
  }
  if (t.type === 'function') return { target: { kind: 'pipe', name: word }, ...t }
  if (t.type === 'string' && /@layout\s*\(\s*$/.test(text.slice(0, t.offset))) {
    const written = word.slice(1, -1)
    // In a view root's template, its own root's layout first.
    const name = ws.refOf(uri === undefined ? undefined : ws.nameOf(uri), written)
    return ws.astOf(name)
      ? { target: { kind: 'layout', name }, offset: t.offset + 1, length: written.length }
      : undefined
  }
  return undefined
}

/** Every use of `target` in the templates. */
function usesOf(ws: Workspace, target: Target): Use[] {
  const out: Use[] = []
  for (const name of ws.names()) {
    const text = ws.textOf(name)
    if (text === undefined) continue
    const uri = ws.uriOf(name)
    if (target.kind === 'layout') {
      for (const m of text.matchAll(LAYOUT))
        if (ws.refOf(name, m[2]!) === target.name)
          out.push({
            uri,
            text,
            from: name,
            written: m[2]!,
            offset: m.index + m[0].length - m[2]!.length - 1,
            length: m[2]!.length,
          })
      continue
    }
    const want = target.kind === 'component' ? 'class' : 'function'
    const match = target.kind === 'component' ? target.tag : target.name
    for (const t of kickTokens(text, (tag) => target.kind === 'component' && tag === target.tag))
      if (
        t.type === want &&
        text.slice(t.offset, t.offset + t.length).toLowerCase() === match.toLowerCase()
      )
        out.push({ uri, text, from: name, written: match, ...t })
  }
  return out
}

/** Where a pipe is declared in `pipes.ts`; only the forms the server can read. */
function pipeDeclaration(ws: Workspace, name: string): Location | undefined {
  const decl = ws.pipeDeclaration(name)
  if (!decl) return undefined
  const start = { line: decl.line, character: decl.column }
  return {
    uri: URI.file(ws.pipesFile()).toString(),
    range: { start, end: { line: decl.line, character: decl.column + name.length } },
  }
}

export function references(
  ws: Workspace,
  text: string,
  offset: number,
  includeDeclaration: boolean,
  uri?: string,
): Location[] {
  const at = targetAt(ws, text, offset, uri)
  if (!at) return []
  const { target } = at
  const locations: Location[] = usesOf(ws, target).map((u) => ({
    uri: u.uri,
    range: rangeOf(u.text, u.offset, u.length),
  }))
  if (includeDeclaration) {
    if (target.kind === 'pipe') {
      const decl = pipeDeclaration(ws, target.name)
      if (decl) locations.push(decl)
    } else locations.push({ uri: ws.uriOf(target.name), range: TOP })
  }
  return locations
}

/** What F2 renames here: a pipe, a component tag or a layout name. */
export function renameRange(
  ws: Workspace,
  text: string,
  offset: number,
  uri?: string,
): Range | { message: string } | undefined {
  const at = targetAt(ws, text, offset, uri)
  if (!at) return undefined
  if (at.target.kind === 'pipe' && !pipeDeclaration(ws, at.target.name))
    return {
      message: `Rename ${at.target.name} in your pipes file; it isn't declared in a form the editor can rename.`,
    }
  return rangeOf(text, at.offset, at.length)
}

const TAG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/

/** The component file for `tag`, kept in the old one's folder when the tag still starts with it. */
function componentNameFor(ws: Workspace, oldName: string, tag: string): string | undefined {
  if (!TAG.test(tag)) return undefined
  const dir = ws.componentsDir()
  // A root's component stays in its root, and its tag keeps the root's prefix.
  const root = rootOf(oldName)
  if (root !== undefined && !tag.startsWith(`${root}-`)) return undefined
  const rest = root === undefined ? tag : tag.slice(root.length + 1)
  const folders = ws
    .pathPart(oldName)
    .slice(dir.length + 1)
    .split('/')
    .slice(0, -1)
  const prefix = folders.join('-')
  const path =
    prefix && rest.startsWith(`${prefix}-`)
      ? `${dir}/${folders.join('/')}/${rest.slice(prefix.length + 1)}`
      : `${dir}/${rest}`
  const name = root === undefined ? path : `${root}::${path}`
  return ws.view.componentTag(name, dir) === tag ? name : undefined
}

/** Every use of `target` replaced with `newText`, then the template's file renamed. */
function renameTemplate(
  ws: Workspace,
  target: Target,
  newText: string | ((use: Use) => string),
  newName: string,
): WorkspaceEdit | undefined {
  if (target.kind === 'pipe') return undefined
  if (ws.view.templateName(newName) !== newName || ws.astOf(newName)) return undefined
  const byUri = new Map<string, TextEdit[]>()
  for (const u of usesOf(ws, target)) {
    const edits = byUri.get(u.uri) ?? []
    edits.push({
      range: rangeOf(u.text, u.offset, u.length),
      newText: typeof newText === 'string' ? newText : newText(u),
    })
    byUri.set(u.uri, edits)
  }
  return {
    documentChanges: [
      // Edits first, at the old URIs: the file moves after them.
      ...[...byUri].map(([uri, edits]) => ({ textDocument: { uri, version: null }, edits })),
      { kind: 'rename' as const, oldUri: ws.uriOf(target.name), newUri: ws.uriOf(newName) },
    ],
  }
}

/** A pipe renamed in every template and in `pipes.ts`; a component or layout, file included. */
export function renameEdits(
  ws: Workspace,
  text: string,
  offset: number,
  newName: string,
  uri?: string,
): WorkspaceEdit | undefined {
  const at = targetAt(ws, text, offset, uri)
  if (!at) return undefined
  const { target } = at
  if (target.kind === 'component') {
    const name = componentNameFor(ws, target.name, newName)
    return name === undefined ? undefined : renameTemplate(ws, target, newName, name)
  }
  if (target.kind === 'layout') {
    // A root's layout stays in its root: `layouts/base` means `ui::layouts/base`.
    const root = rootOf(target.name)
    const full = root !== undefined && !newName.includes('::') ? `${root}::${newName}` : newName
    return renameTemplate(ws, target, (u) => layoutText(ws, u, full), full)
  }
  if (!IDENT.test(newName) || ws.project().pipes.has(newName)) return undefined
  const decl = pipeDeclaration(ws, target.name)
  if (!decl) return undefined
  const changes: Record<string, TextEdit[]> = {}
  const add = (uri: string, range: Range) => (changes[uri] ??= []).push({ range, newText: newName })
  for (const u of usesOf(ws, target)) add(u.uri, rangeOf(u.text, u.offset, u.length))
  add(decl.uri, decl.range)
  return { changes }
}

/**
 * Edits that keep uses pointing at renamed templates: a component's tags, a
 * layout's `@layout('…')`, a page's `ctx.render('…')`. `oldUri` / `newUri`
 * can be a file or a folder.
 */
export async function fileRenameEdits(
  ws: Workspace,
  oldUri: string,
  newUri: string,
): Promise<WorkspaceEdit | undefined> {
  const from = ws.relOf(oldUri)?.replace(/\.kick$/, '')
  const to = ws.relOf(newUri)?.replace(/\.kick$/, '')
  if (from === undefined || to === undefined || from === to) return undefined
  const renamed = new Map<string, string>()
  for (const name of ws.names()) {
    if (name === from) renamed.set(name, to)
    else if (name.startsWith(`${from}/`)) renamed.set(name, to + name.slice(from.length))
  }
  if (!renamed.size) return undefined
  const changes: Record<string, TextEdit[]> = {}
  const dir = ws.componentsDir()
  for (const [oldName, newName] of renamed) {
    const comp = ws.isComponent(oldName)
    const newTag = ws.isComponent(newName) ? ws.view.componentTag(newName, dir) : undefined
    const targets: Array<[Target, string]> = [[{ kind: 'layout', name: oldName }, newName]]
    if (comp && newTag)
      targets.push([
        { kind: 'component', name: oldName, tag: ws.view.componentTag(oldName, dir)! },
        newTag,
      ])
    for (const [target, newText] of targets)
      for (const u of usesOf(ws, target))
        (changes[u.uri] ??= []).push({
          range: rangeOf(u.text, u.offset, u.length),
          newText: target.kind === 'layout' ? layoutText(ws, u, newText) : newText,
        })
  }
  // Pages named in `ctx.render('…')` / `views.render('…')`.
  const pages = [...renamed].filter(([n]) => !ws.isComponent(n))
  if (pages.length) {
    const to = new Map(pages)
    for (const script of await ws.scripts())
      for (const c of calls(script.text)) {
        const newName = to.get(c.name)
        if (newName !== undefined)
          (changes[script.uri] ??= []).push({
            range: rangeOf(script.text, c.offset, c.name.length),
            newText: newName,
          })
      }
  }
  return Object.keys(changes).length ? { changes } : undefined
}
