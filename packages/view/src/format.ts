/**
 * `format`: tidy a `.kick` source — `{{ x }}` and `@if (x) {` spacing, and
 * indentation by block and element nesting. Raw regions (`<pre>`,
 * `<textarea>`, `<script>`, `<style>`, `@verbatim`, comments) are left
 * byte-exact. The result is re-parsed and compared with the original;
 * anything beyond whitespace changing returns the source untouched.
 */
import type { Element, Node } from './ast'
import { warning, type Diagnostic } from './diagnostics'
import { parse } from './parse/template'

export interface FormatOptions {
  /** Spaces per level. Default 2. */
  indent?: number
}

const RAW = new Set(['pre', 'textarea', 'script', 'style'])
const VOID = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
)
/** Block heads: control flow is spaced (`@if (a) {`), directives aren't (`@layout('x')`). */
const HEADS = /@(else\s+if|if|for|switch|case|slot|layout|assets)\s*\(/y
const DIRECTIVES = new Set(['slot', 'layout', 'assets'])

type Range = [number, number]

/** Source ranges formatting must not touch. */
function rawRanges(source: string, body: Node[]): Range[] {
  const ranges: Range[] = []
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.k === 'verbatim' || n.k === 'comment') {
        ranges.push([n.span.start.offset, n.span.end.offset])
      } else if (n.k === 'element') {
        const tag = n.tag.toLowerCase()
        if (RAW.has(tag) && !n.selfClosing) {
          const from = n.children.at(-1)?.span.end.offset ?? n.span.end.offset
          const close = source.toLowerCase().indexOf(`</${tag}`, from)
          const end = close < 0 ? source.length : source.indexOf('>', close) + 1
          ranges.push([n.span.start.offset, end])
        } else walk(n.children)
      } else if (n.k === 'if') n.branches.forEach((b) => walk(b.body))
      else if (n.k === 'for') {
        walk(n.body)
        if (n.empty) walk(n.empty)
      } else if (n.k === 'switch') {
        n.cases.forEach((c) => walk(c.body))
        if (n.default) walk(n.default)
      } else if (n.k === 'slot-outlet') walk(n.fallback)
      else if (n.k === 'slot-fill') walk(n.body)
    }
  }
  walk(body)
  for (const m of source.matchAll(/\{\{--[\s\S]*?--\}\}/g))
    ranges.push([m.index, m.index + m[0].length])
  return ranges.toSorted((a, b) => a[0] - b[0])
}

/** `{{x}}` → `{{ x }}`, `@if(a){` → `@if (a) {`, `}@else{` → `} @else {`. */
function normalise(text: string): string {
  let s = text.replace(/\{\{(?!--)([\s\S]*?)\}\}/g, (_, inner: string) => `{{ ${inner.trim()} }}`)
  s = s.replace(/\}[ \t]*@(else|empty)\b/g, '} @$1')
  s = s.replace(/@(else|empty|default)[ \t]*\{/g, '@$1 {')
  // `@kw(` → `@kw (`, and `) {` after the balanced header.
  let out = ''
  let i = 0
  while (i < s.length) {
    HEADS.lastIndex = i
    const at = s.indexOf('@', i)
    if (at < 0) break
    HEADS.lastIndex = at
    const m = HEADS.exec(s)
    if (!m) {
      out += s.slice(i, at + 1)
      i = at + 1
      continue
    }
    const kw = m[1]!.replace(/\s+/g, ' ')
    out += s.slice(i, at) + (DIRECTIVES.has(kw) ? `@${kw}(` : `@${kw} (`)
    let depth = 1
    let j = at + m[0].length
    let quote = ''
    for (; j < s.length && depth > 0; j++) {
      const c = s[j]!
      if (quote) {
        if (c === '\\') j++
        else if (c === quote) quote = ''
      } else if (c === "'" || c === '"') quote = c
      else if (c === '(') depth++
      else if (c === ')') depth--
    }
    // The header's own text, trimmed inside the parentheses.
    out += `${s.slice(at + m[0].length, j - 1).trim()})`
    const brace = /^[ \t]*\{/.exec(s.slice(j))
    if (brace) {
      out += ' {'
      j += brace[0].length
    }
    i = j
  }
  return out + s.slice(i)
}

/** Apply `fn` to the parts of `source` outside `ranges`. */
function outside(source: string, ranges: Range[], fn: (s: string) => string): string {
  let out = ''
  let at = 0
  for (const [a, b] of ranges) {
    if (a < at) continue
    out += fn(source.slice(at, a)) + source.slice(a, b)
    at = b
  }
  return out + fn(source.slice(at))
}

const TOKENS =
  /<\/([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>|@(?:if|for|switch|case|slot|else|empty|default)\b[^{}\n]*\{|\}/g

/** Re-indent lines by the blocks and elements open at their start. */
function reindent(source: string, ranges: Range[], unit: string): string {
  const stack: string[] = []
  const lines = source.split('\n')
  let offset = 0
  const out: string[] = []
  for (const raw of lines) {
    const start = offset
    offset += raw.length + 1
    const inside = ranges.some(([a, b]) => start > a && start < b)
    if (inside) {
      out.push(raw)
      continue
    }
    // Mask raw regions on this line so their content isn't read as structure.
    let line = raw
    for (const [a, b] of ranges) {
      const from = Math.max(a, start) - start
      const to = Math.min(b, start + raw.length) - start
      if (from < to) line = line.slice(0, from) + '\u0000'.repeat(to - from) + line.slice(to)
    }
    line = line.replace(/\{\{[\s\S]*?\}\}/g, (m) => '\u0000'.repeat(m.length))
    const content = raw.trim()
    if (!content) {
      out.push('')
      continue
    }
    let leading = true
    let depthForLine = stack.length
    TOKENS.lastIndex = 0
    let m: RegExpExecArray | null
    let last = 0
    while ((m = TOKENS.exec(line))) {
      if (line.slice(last, m.index).trim()) leading = false
      last = m.index + m[0].length
      const [tok, closeTag, openTag, selfClose] = m
      let closed = false
      if (tok === '}') {
        const i = stack.lastIndexOf('{')
        if (i >= 0) {
          stack.length = i
          closed = true
        }
      } else if (closeTag) {
        const i = stack.lastIndexOf(`<${closeTag.toLowerCase()}`)
        if (i >= 0) {
          stack.length = i
          closed = true
        }
      } else if (openTag) {
        const tag = openTag.toLowerCase()
        if (!selfClose && !VOID.has(tag) && !RAW.has(tag)) stack.push(`<${tag}`)
      } else {
        stack.push('{')
      }
      if (leading && closed) depthForLine = stack.length
      if (!closed) leading = false
    }
    out.push(unit.repeat(Math.max(0, depthForLine)) + content)
  }
  return out.join('\n')
}

/** The tree with whitespace-only differences removed, for comparing before and after. */
function shape(nodes: Node[]): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v
        .map(strip)
        .filter(
          (x) =>
            !(
              x &&
              typeof x === 'object' &&
              (x as { k?: string }).k === 'text' &&
              !(x as { value: string }).value
            ),
        )
    }
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) {
        if (k === 'span' || k === 'layoutSpan') continue
        o[k] = strip(x)
      }
      if (o.k === 'text') o.value = String(o.value).replace(/\s+/g, ' ').trim()
      return o
    }
    return v
  }
  return strip(nodes)
}

export function format(
  source: string,
  file: string,
  opts: FormatOptions = {},
): { output?: string; diagnostics: Diagnostic[] } {
  const before = parse(source, file)
  if (before.diagnostics.some((d) => d.severity === 'error'))
    return { diagnostics: before.diagnostics }
  const unit = ' '.repeat(opts.indent ?? 2)
  const normalised = outside(source, rawRanges(source, before.ast.body), normalise)
  const mid = parse(normalised, file)
  let output = normalised
  if (!mid.diagnostics.some((d) => d.severity === 'error')) {
    output = reindent(normalised, rawRanges(normalised, mid.ast.body), unit)
  }
  if (!output.endsWith('\n')) output += '\n'
  const after = parse(output, file)
  const same =
    !after.diagnostics.some((d) => d.severity === 'error') &&
    JSON.stringify(shape(after.ast.body)) === JSON.stringify(shape(before.ast.body)) &&
    after.ast.layout === before.ast.layout
  if (!same) {
    const pos = { offset: 0, line: 1, column: 1 }
    return {
      output: source,
      diagnostics: [
        warning(
          file,
          { start: pos, end: pos },
          'left unformatted: formatting would have changed more than whitespace',
        ),
      ],
    }
  }
  return { output, diagnostics: [] }
}

export type { Element }
