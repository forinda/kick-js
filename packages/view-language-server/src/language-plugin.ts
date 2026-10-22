/**
 * The Volar language plugin: each `.kick` file becomes a `KickVirtualCode`
 * whose embedded codes the HTML, CSS and JS services work on. The HTML copy
 * is the source with template syntax blanked to spaces, so every offset is
 * the same in both; blanked ranges aren't mapped, so the HTML service never
 * reports or completes inside them.
 *
 * Found by a lexical scan rather than the parser: the buffer being typed in
 * rarely parses, and the HTML service has to keep working while it doesn't.
 */
import type {
  CodeInformation,
  CodeMapping,
  IScriptSnapshot,
  LanguagePlugin,
  VirtualCode,
} from '@volar/language-core'
import type { URI } from 'vscode-uri'

const ALL: CodeInformation = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: true,
}
/** Embedded documents never format: the kick formatter owns the whole file. */
const EMBEDDED: CodeInformation = { ...ALL, format: false }

export const KEYWORD =
  /^@(else\s+if|if|for|switch|case|slot|error|layout|assets|verbatim|let|input|else|empty|default)(?![\w$-])/

const snapshotOf = (text: string): IScriptSnapshot => ({
  getText: (start, end) => text.slice(start, end),
  getLength: () => text.length,
  getChangeRange: () => undefined,
})

type Range = [number, number]

interface Scan {
  blank: Range[]
  styles: Range[]
  /** A script's range, and whether it's a `<script client>` (TypeScript). */
  scripts: Array<{ range: Range; ts: boolean }>
}

/** The end of a `(`…`)` group starting at `i` (at `(`); the text's end when unclosed. */
export function closeParen(s: string, i: number): number {
  let depth = 0
  let quote = ''
  for (let j = i; j < s.length; j++) {
    const c = s[j]!
    if (quote) {
      if (c === '\\') j++
      else if (c === quote) quote = ''
    } else if (c === "'" || c === '"') quote = c
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return j + 1
  }
  return s.length
}

/**
 * Where an `@let` value from `from` ends: its `;` outside quotes, as the
 * parser reads it; the line's end while it's unterminated, so typing one
 * doesn't swallow the lines below.
 */
export function letEnd(s: string, from: number): { at: number; closed: boolean } {
  let quote = ''
  for (let j = from; j < s.length; j++) {
    const c = s[j]!
    if (c === '\n') return { at: j, closed: false }
    if (quote) {
      if (c === '\\') j++
      else if (c === quote) quote = ''
    } else if (c === "'" || c === '"') quote = c
    else if (c === ';') return { at: j, closed: true }
  }
  return { at: s.length, closed: false }
}

/** The end of `@verbatim { … }` from `brace` (at `{`): after its `}`, quoted braces skipped as the parser does. */
export function verbatimEnd(s: string, brace: number): number {
  let depth = 0
  let quote = ''
  for (let k = brace; k < s.length; k++) {
    const c = s[k]!
    if (quote) {
      if (c === '\\') k++
      else if (c === quote) quote = ''
    } else if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return k + 1
  }
  return s.length
}

/** The end of a `{{ … }}` starting at `i`; the text's end when unclosed. */
export function closeInterp(s: string, i: number): number {
  let quote = ''
  for (let j = i + 2; j < s.length; j++) {
    const c = s[j]!
    if (quote) {
      if (c === '\\') j++
      else if (c === quote) quote = ''
    } else if (c === "'" || c === '"') quote = c
    else if (c === '}' && s[j + 1] === '}') return j + 2
  }
  return s.length
}

function scan(s: string): Scan {
  const out: Scan = { blank: [], styles: [], scripts: [] }
  let depth = 0
  let i = 0
  const skipWs = (j: number) => {
    while (j < s.length && /\s/.test(s[j]!)) j++
    return j
  }
  while (i < s.length) {
    const c = s[i]!
    if (c === '{' && s.startsWith('{{--', i)) {
      const end = s.indexOf('--}}', i + 4)
      const stop = end < 0 ? s.length : end + 4
      out.blank.push([i, stop])
      i = stop
      continue
    }
    if (c === '{' && s[i + 1] === '{') {
      const stop = closeInterp(s, i)
      out.blank.push([i, stop])
      i = stop
      continue
    }
    if (c === '<' && s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4)
      i = end < 0 ? s.length : end + 3
      continue
    }
    // `</` alone (a close tag being typed) is text until a name follows.
    if (c === '<' && /^<\/?[A-Za-z]/.test(s.slice(i, i + 3))) {
      i = tag(s, i, out)
      continue
    }
    if (c === '@' && !/[\w@.-]/.test(s[i - 1] ?? '')) {
      const m = KEYWORD.exec(s.slice(i, i + 16))
      if (m) {
        const kw = m[1]!.replace(/\s+/g, ' ')
        let j = i + m[0].length
        if (kw === 'let' || kw === 'input') {
          const eol = s.indexOf('\n', j)
          const end = kw === 'let' ? letEnd(s, j) : undefined
          const stop = end ? end.at + (end.closed ? 1 : 0) : eol < 0 ? s.length : eol
          out.blank.push([i, stop])
          i = stop
          continue
        }
        if (kw === 'verbatim') {
          const b = skipWs(j)
          if (s[b] === '{') {
            const stop = verbatimEnd(s, b)
            out.blank.push([i, stop])
            i = stop
            continue
          }
        }
        const p = skipWs(j)
        if (s[p] === '(') j = closeParen(s, p)
        else if (kw !== 'else' && kw !== 'empty' && kw !== 'default') {
          i++
          continue
        }
        if (kw === 'layout' || kw === 'assets') {
          out.blank.push([i, j])
          i = j
          continue
        }
        const b = skipWs(j)
        if (s[b] === '{') {
          out.blank.push([i, b + 1])
          depth++
          i = b + 1
          continue
        }
        out.blank.push([i, j])
        i = j
        continue
      }
    }
    if (c === '}' && depth > 0) {
      out.blank.push([i, i + 1])
      depth--
      i++
      continue
    }
    i++
  }
  return out
}

/** One tag from `i` (at `<`): interpolations and binding values blanked; script / style content recorded. */
function tag(s: string, i: number, out: Scan): number {
  const m = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(s.slice(i, i + 64))!
  let j = i + m[0].length
  const closing = !!m[1]
  const name = m[2]!.toLowerCase()
  let type = ''
  while (j < s.length && s[j] !== '>') {
    const binding = /^\[[^\]\s]+\]\s*=\s*(["'])/.exec(s.slice(j, j + 128))
    if (binding) {
      const q = binding[1]!
      const from = j + binding[0].length
      const end = s.indexOf(q, from)
      const stop = end < 0 ? s.length : end
      out.blank.push([from, stop])
      j = stop + 1
      continue
    }
    const t = /^type\s*=\s*(["'])([^"']*)\1/i.exec(s.slice(j, j + 128))
    if (t) type = t[2]!.trim().toLowerCase()
    const q = s[j]
    if (q === '"' || q === "'") {
      const end = s.indexOf(q, j + 1)
      const stop = end < 0 ? s.length : end
      for (let k = j + 1; k < stop; k++) {
        if (s[k] === '{' && s[k + 1] === '{') {
          const e = Math.min(closeInterp(s, k), stop)
          out.blank.push([k, e])
          k = e - 1
        }
      }
      j = stop + 1
      continue
    }
    j++
  }
  j = Math.min(j + 1, s.length)
  if (closing || (name !== 'script' && name !== 'style') || s[j - 2] === '/') return j
  // Raw text: up to its close tag, with {{ }} blanked (a JSON script's value).
  const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'i').exec(s.slice(j))
  const end = close ? j + close.index : s.length
  for (let k = j; k < end; k++) {
    if (s[k] === '{' && s[k + 1] === '{') {
      const e = Math.min(closeInterp(s, k), end)
      out.blank.push([k, e])
      k = e - 1
    }
  }
  if (name === 'style') out.styles.push([j, end])
  else if (type !== 'application/json' && type !== 'application/ld+json')
    // `<script client>`: a component's browser code, written in TypeScript.
    out.scripts.push({ range: [j, end], ts: /\sclient(?=[\s/>=]|$)/i.test(s.slice(i, j)) })
  return end
}

function embedded(id: string, languageId: string, text: string, [from, to]: Range): VirtualCode {
  return {
    id,
    languageId,
    snapshot: snapshotOf(text.slice(from, to)),
    mappings: [
      { sourceOffsets: [from], generatedOffsets: [0], lengths: [to - from], data: EMBEDDED },
    ],
  }
}

export class KickVirtualCode implements VirtualCode {
  readonly id = 'root'
  readonly languageId = 'kick'
  readonly snapshot: IScriptSnapshot
  readonly mappings: CodeMapping[]
  readonly embeddedCodes: VirtualCode[]

  constructor(readonly text: string) {
    this.snapshot = snapshotOf(text)
    this.mappings = [
      { sourceOffsets: [0], generatedOffsets: [0], lengths: [text.length], data: ALL },
    ]
    const { blank, styles, scripts } = scan(text)
    const sorted = blank.toSorted((a, b) => a[0] - b[0])
    let html = ''
    const htmlMappings: CodeMapping[] = []
    let at = 0
    const keep = (from: number, to: number) => {
      if (to <= from) return
      html += text.slice(from, to)
      htmlMappings.push({
        sourceOffsets: [from],
        generatedOffsets: [from],
        lengths: [to - from],
        data: EMBEDDED,
      })
    }
    for (const [a, b] of sorted) {
      if (a < at) {
        // Overlapping range: blank the part not yet covered.
        if (b > at) {
          html += text.slice(at, b).replace(/[^\n\r]/g, ' ')
          at = b
        }
        continue
      }
      keep(at, a)
      html += text.slice(a, b).replace(/[^\n\r]/g, ' ')
      at = b
    }
    keep(at, text.length)
    this.embeddedCodes = [
      { id: 'html', languageId: 'html', snapshot: snapshotOf(html), mappings: htmlMappings },
      ...styles.map((r, n) => embedded(`css_${n}`, 'css', text, r)),
      ...scripts.map((c, n) =>
        embedded(`js_${n}`, c.ts ? 'typescript' : 'javascript', text, c.range),
      ),
    ]
  }
}

/** TS / JS: a code only the kick service plugin reads, for `ctx.render('…')` names. */
const SCRIPT_IDS = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact'])
const SCRIPT_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/

class RenderCallsCode implements VirtualCode {
  readonly id = 'root'
  // Not `typescript`: the HTML, CSS and Emmet services leave it alone.
  readonly languageId = 'kick-render'
  readonly snapshot: IScriptSnapshot
  readonly mappings: CodeMapping[]
  readonly embeddedCodes: VirtualCode[] = []

  constructor(text: string) {
    this.snapshot = snapshotOf(text)
    this.mappings = [
      { sourceOffsets: [0], generatedOffsets: [0], lengths: [text.length], data: EMBEDDED },
    ]
  }
}

export const kickLanguagePlugin: LanguagePlugin<URI> = {
  getLanguageId(uri) {
    return uri.path.endsWith('.kick') ? 'kick' : undefined
  },
  // By the file name too: not every editor sends the `kick` languageId.
  createVirtualCode(uri, languageId, snapshot) {
    const text = snapshot.getText(0, snapshot.getLength())
    if (languageId === 'kick' || uri.path.endsWith('.kick')) return new KickVirtualCode(text)
    if (SCRIPT_IDS.has(languageId) || SCRIPT_FILE.test(uri.path)) return new RenderCallsCode(text)
    return undefined
  },
}
