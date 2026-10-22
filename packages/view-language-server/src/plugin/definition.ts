/** Go to definition: a component tag to its file, `@layout('…')` to the layout, a pipe to `pipes.ts`. */
import type { LocationLink } from '@volar/language-service'
import { URI } from 'vscode-uri'
import { cursorContext, wordAt } from '../context'
import type { Workspace } from '../workspace'
import { componentOf } from './completion'
import { posOf } from './hover'

const TOP = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

export function definition(
  ws: Workspace,
  _uri: string,
  text: string,
  offset: number,
): LocationLink | null {
  const { word, start, end } = wordAt(text, offset)
  if (!word) return null
  const origin = { start: posOf(text, start), end: posOf(text, end) }
  const link = (targetUri: string, targetRange = TOP): LocationLink => ({
    originSelectionRange: origin,
    targetUri,
    targetRange,
    targetSelectionRange: targetRange,
  })
  const c = cursorContext(text, end)
  if (c.kind === 'tag') {
    const name = componentOf(ws, word.toLowerCase())
    return name === undefined ? null : link(ws.uriOf(name))
  }
  if (c.kind === 'template-name') {
    return ws.astOf(word) ? link(ws.uriOf(word)) : null
  }
  if (c.kind === 'pipe') {
    const decl = ws.pipeDeclaration(word)
    if (!decl) return null
    const at = { line: decl.line, character: decl.column }
    const range = { start: at, end: { line: decl.line, character: decl.column + word.length } }
    return link(URI.file(ws.pipesFile()).toString(), range)
  }
  return null
}
