/**
 * `ctx.render('…')` and `views.render('…')` in TypeScript and JavaScript:
 * template names completed, linked to their files, and checked. For editors
 * that attach this server to TS / JS files too.
 */
import type { CompletionItem, Diagnostic, LocationLink } from '@volar/language-service'
import type { Workspace } from '../workspace'
import { posOf } from './hover'

/** A call's template name as typed so far, up to the cursor. */
const OPEN_CALL = /\b(?:ctx|views)\.render\(\s*(['"`])([^'"`\n]*)$/
/** Every call with a literal name. */
const CALLS = /\b(?:ctx|views)\.render\(\s*(['"`])([^'"`\n]*)\1/g

const FILE = 17

/** Template names a page can render: everything but components. */
function renderable(ws: Workspace): string[] {
  const dir = `${ws.componentsDir()}/`
  return ws.names().filter((n) => !n.startsWith(dir))
}

export function renderCompletions(
  ws: Workspace,
  text: string,
  offset: number,
): CompletionItem[] | undefined {
  const m = OPEN_CALL.exec(text.slice(0, offset))
  if (!m) return undefined
  const range = { start: posOf(text, offset - m[2]!.length), end: posOf(text, offset) }
  return renderable(ws).map((name) => ({
    label: name,
    kind: FILE,
    textEdit: { range, newText: name },
  }))
}

/** Calls whose name is a plain literal (not a template string with `${…}`). */
function calls(text: string): Array<{ name: string; offset: number }> {
  return [...text.matchAll(CALLS)]
    .filter((m) => !m[2]!.includes('${'))
    .map((m) => ({ name: m[2]!, offset: m.index + m[0].length - m[2]!.length - 1 }))
}

export function renderDefinition(ws: Workspace, text: string, offset: number): LocationLink | null {
  const call = calls(text).find((c) => offset >= c.offset && offset <= c.offset + c.name.length)
  if (!call || !ws.astOf(call.name)) return null
  const top = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
  return {
    originSelectionRange: {
      start: posOf(text, call.offset),
      end: posOf(text, call.offset + call.name.length),
    },
    targetUri: ws.uriOf(call.name),
    targetRange: top,
    targetSelectionRange: top,
  }
}

export function renderDiagnostics(ws: Workspace, text: string): Diagnostic[] {
  return calls(text)
    .filter((c) => !ws.astOf(c.name))
    .map((c) => ({
      range: { start: posOf(text, c.offset), end: posOf(text, c.offset + c.name.length) },
      severity: 2,
      source: 'kick',
      message: `template '${c.name}' not found`,
    }))
}
