/** Hover for pipes (built-in descriptions, app signatures) and component tags (their inputs). */
import type { Hover } from '@volar/language-service'
import { cursorContext, wordAt } from '../context'
import type { Workspace } from '../workspace'
import { componentOf } from './completion'

/** Worded as in the guide's pipe table. */
const BUILTIN: Record<string, string> = {
  uppercase: '`uppercase` — the text in upper case',
  lowercase: '`lowercase` — the text in lower case',
  titlecase: '`titlecase` — each word capitalised',
  date: "`date:format:timeZone?` — `short`, `medium`, `long`, `full`, `shortDate`, … e.g. `date:'short'`",
  number: "`number:digits` — `minInt.minFrac-maxFrac`, e.g. `number:'1.0-2'`",
  currency: "`currency:code:digits?` — e.g. `currency:'KES'`",
  percent: '`percent:digits?` — a ratio as a percentage',
  slice: '`slice:start:end` — part of a list or string',
  keys: '`keys` — an object’s keys',
  entries: '`entries` — an object’s `[key, value]` pairs',
  json: '`json` — the value as JSON',
  url: '`url` — URL-encoded for a query string',
  raw: '`raw` — the HTML unescaped; only for trusted markup',
}

export function hover(ws: Workspace, _uri: string, text: string, offset: number): Hover | null {
  const { word, start, end } = wordAt(text, offset)
  if (!word) return null
  const c = cursorContext(text, end)
  const md = (value: string): Hover => ({
    contents: { kind: 'markdown', value },
    range: { start: posOf(text, start), end: posOf(text, end) },
  })
  if (c.kind === 'pipe') {
    if (BUILTIN[word]) return md(BUILTIN[word])
    const decl = ws.pipeDeclaration(word)
    return decl ? md(`\`\`\`ts\n${decl.signature}\n\`\`\``) : null
  }
  if (c.kind === 'tag') {
    const name = componentOf(ws, word.toLowerCase())
    const ast = name === undefined ? undefined : ws.astOf(name)
    if (!ast) return null
    const lines = ast.inputs.map((i) =>
      i.default
        ? `- \`${i.name}\` = \`${JSON.stringify(i.default.value)}\``
        : `- \`${i.name}\` (required)`,
    )
    return md([`**<${word}>** — \`${name}.kick\``, ...lines].join('\n'))
  }
  return null
}

export function posOf(text: string, offset: number) {
  const before = text.slice(0, offset).split('\n')
  return { line: before.length - 1, character: before.at(-1)!.length }
}
