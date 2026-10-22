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

/** The shared name under the cursor, with where it sits in `text`. */
function targetAt(
  ws: Workspace,
  text: string,
  offset: number,
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
    const name = word.slice(1, -1)
    return ws.astOf(name)
      ? { target: { kind: 'layout', name }, offset: t.offset + 1, length: name.length }
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
        if (m[2] === target.name)
          out.push({
            uri,
            text,
            offset: m.index + m[0].length - m[2].length - 1,
            length: m[2].length,
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
        out.push({ uri, text, ...t })
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
): Location[] {
  const at = targetAt(ws, text, offset)
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
): Range | { message: string } | undefined {
  const at = targetAt(ws, text, offset)
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
  const folders = oldName
    .slice(dir.length + 1)
    .split('/')
    .slice(0, -1)
  const prefix = folders.join('-')
  const name =
    prefix && tag.startsWith(`${prefix}-`)
      ? `${dir}/${folders.join('/')}/${tag.slice(prefix.length + 1)}`
      : `${dir}/${tag}`
  return ws.view.componentTag(name, dir) === tag ? name : undefined
}

/** Every use of `target` replaced with `newText`, then the template's file renamed. */
function renameTemplate(
  ws: Workspace,
  target: Target,
  newText: string,
  newName: string,
): WorkspaceEdit | undefined {
  if (target.kind === 'pipe') return undefined
  if (ws.view.templateName(newName) !== newName || ws.astOf(newName)) return undefined
  const byUri = new Map<string, TextEdit[]>()
  for (const u of usesOf(ws, target)) {
    const edits = byUri.get(u.uri) ?? []
    edits.push({ range: rangeOf(u.text, u.offset, u.length), newText })
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
): WorkspaceEdit | undefined {
  const at = targetAt(ws, text, offset)
  if (!at) return undefined
  const { target } = at
  if (target.kind === 'component') {
    const name = componentNameFor(ws, target.name, newName)
    return name === undefined ? undefined : renameTemplate(ws, target, newName, name)
  }
  if (target.kind === 'layout') return renameTemplate(ws, target, newName, newName)
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
    const comp = oldName.startsWith(`${dir}/`)
    const newTag = newName.startsWith(`${dir}/`) ? ws.view.componentTag(newName, dir) : undefined
    const targets: Array<[Target, string]> = [[{ kind: 'layout', name: oldName }, newName]]
    if (comp && newTag)
      targets.push([
        { kind: 'component', name: oldName, tag: ws.view.componentTag(oldName, dir)! },
        newTag,
      ])
    for (const [target, newText] of targets)
      for (const u of usesOf(ws, target))
        (changes[u.uri] ??= []).push({ range: rangeOf(u.text, u.offset, u.length), newText })
  }
  // Pages named in `ctx.render('…')` / `views.render('…')`.
  const pages = [...renamed].filter(([n]) => !n.startsWith(`${dir}/`))
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
