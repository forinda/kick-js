/** Document formatting through the engine's own `format` — the same output as `kick fmt:views`. */
import type { TextEdit } from '@volar/language-service'
import type { ViewModule } from '../workspace'
import { posOf } from './hover'

/** One whole-document edit, or none on a parse error or when nothing changes. */
export function formatEdits(
  view: ViewModule,
  text: string,
  file: string,
  tabSize: number,
): TextEdit[] {
  const { output } = view.format(text, file, { indent: tabSize })
  if (output === undefined || output === text) return []
  return [
    { range: { start: { line: 0, character: 0 }, end: posOf(text, text.length) }, newText: output },
  ]
}
