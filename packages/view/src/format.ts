/**
 * `format`: tidy a `.kick` source — `{{ x | pipe }}` and `@if (x) {` spacing, and
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
/** Text up to its own closing tag: tag-like text inside isn't structure. */
const RCDATA = new Set(['<title', '<textarea'])
const VOID = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
)
/** Block heads: control flow is spaced (`@if (a) {`), directives aren't (`@layout('x')`). */
const HEADS = /@(else\s+if|if|for|switch|case|slot|error|layout|assets)\s*\(/y
const DIRECTIVES = new Set(['slot', 'error', 'layout', 'assets'])

type Range = [number, number]

/** Source ranges formatting must not touch. */
function rawRanges(source: string, body: Node[]): Range[] {
  const ranges: Range[] = []
  const stack: Node[][] = [body]
  while (stack.length) {
    for (const n of stack.pop()!) {
      if (n.k === 'verbatim' || n.k === 'comment') {
        ranges.push([n.span.start.offset, n.span.end.offset])
      } else if (n.k === 'element') {
        const tag = n.tag.toLowerCase()
        if (RAW.has(tag) && !n.selfClosing) {
          const from = n.children.at(-1)?.span.end.offset ?? n.span.end.offset
          const close = source.toLowerCase().indexOf(`</${tag}`, from)
          const end = close < 0 ? source.length : source.indexOf('>', close) + 1
          ranges.push([n.span.start.offset, end])
        } else stack.push(n.children)
      } else if (n.k === 'if') for (const b of n.branches) stack.push(b.body)
      else if (n.k === 'for') stack.push(n.body, n.empty ?? [])
      else if (n.k === 'switch') stack.push(...n.cases.map((c) => c.body), n.default ?? [])
      else if (n.k === 'slot-outlet') stack.push(n.fallback)
      else if (n.k === 'slot-fill') stack.push(n.body)
    }
  }
  for (const m of source.matchAll(/\{\{--[\s\S]*?--\}\}/g))
    ranges.push([m.index, m.index + m[0].length])
  return ranges.toSorted((a, b) => a[0] - b[0])
}

/** `a|b` → `a | b` in an expression; `||` and quoted text are left alone. */
function spacePipes(expr: string): string {
  let out = ''
  let quote = ''
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!
    if (quote) {
      out += c
      if (c === '\\') out += expr[++i] ?? ''
      else if (c === quote) quote = ''
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c
      out += c
    } else if (c === '|' && expr[i + 1] === '|') {
      out += '||'
      i++
    } else if (c === '|') {
      out = `${out.trimEnd()} | `
      while (/[ \t]/.test(expr[i + 1] ?? '')) i++
    } else out += c
  }
  return out
}

/** `{{x|p}}` → `{{ x | p }}`, `@if(a){` → `@if (a) {`, `}@else{` → `} @else {`. */
function normalise(text: string): string {
  let s = text.replace(
    /\{\{(?!--)([\s\S]*?)\}\}/g,
    (_, inner: string) => `{{ ${spacePipes(inner.trim())} }}`,
  )
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
    const header = s.slice(at + m[0].length, j - 1).trim()
    out += `${DIRECTIVES.has(kw) ? header : spacePipes(header)})`
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
  /<\/([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>|@(?:if|for|switch|case|slot|error|else|empty|default)\b[^{}\n]*\{|\}/g

/**
 * Re-indent lines by the blocks and elements open at their start. A closer
 * after content (`<b>x</b></slot>`, `x }`) whose opener is on an earlier line
 * moves to its own line.
 */
function reindent(source: string, ranges: Range[], unit: string): string {
  /** Open blocks and elements, with the line each opened on. */
  const stack: Array<{ key: string; line: number }> = []
  const lastIndex = (key: string) => stack.findLastIndex((e) => e.key === key)
  const out: string[] = []
  const queue = source.split('\n')
  let offset = 0
  for (let n = 0; n < queue.length; n++) {
    const raw = queue[n]!
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
    let split = -1
    while ((m = TOKENS.exec(line))) {
      if (line.slice(last, m.index).trim()) leading = false
      last = m.index + m[0].length
      const [tok, closeTag, openTag, selfClose] = m
      const top = stack.at(-1)?.key
      if (top && RCDATA.has(top) && `<${closeTag?.toLowerCase()}` !== top) continue
      const i =
        tok === '}' ? lastIndex('{') : closeTag ? lastIndex(`<${closeTag.toLowerCase()}`) : -1
      if (i >= 0 && !leading && stack[i]!.line < n) {
        split = m.index
        break
      }
      if (i >= 0) {
        stack.length = i
        if (leading) depthForLine = stack.length
        continue
      }
      if (openTag) {
        const tag = openTag.toLowerCase()
        if (!selfClose && !VOID.has(tag) && !RAW.has(tag)) stack.push({ key: `<${tag}`, line: n })
      } else if (!closeTag && tok !== '}') stack.push({ key: '{', line: n })
      leading = false
    }
    if (split < 0) {
      out.push(unit.repeat(Math.max(0, depthForLine)) + content)
      continue
    }
    // The closer and what follows become the next line.
    out.push(unit.repeat(Math.max(0, depthForLine)) + raw.slice(0, split).trim())
    queue.splice(n + 1, 0, raw.slice(split))
    offset = start + split
  }
  return out.join('\n')
}

/** Keys holding child nodes: walked separately, so the shape is built without recursion. */
const CHILD_KEYS = new Set(['children', 'body', 'empty', 'default', 'fallback'])

function childLists(n: Node): Node[][] {
  switch (n.k) {
    case 'element':
    case 'comment':
      return [n.children]
    case 'if':
      return n.branches.map((b) => b.body)
    case 'for':
      return [n.body, n.empty ?? []]
    case 'switch':
      return [...n.cases.map((c) => c.body), n.default ?? []]
    case 'slot-outlet':
      return [n.fallback]
    case 'slot-fill':
      return [n.body]
    default:
      return []
  }
}

/** The tree as a flat token list, with whitespace-only text differences removed. */
function shape(nodes: Node[]): string[] {
  const out: string[] = []
  const stack: Array<Node | string> = nodes.toReversed()
  while (stack.length) {
    const n = stack.pop()!
    if (typeof n === 'string') {
      out.push(n)
      continue
    }
    if (n.k === 'text') {
      const v = n.value.replace(/\s+/g, ' ').trim()
      if (v) out.push(`t:${v}`)
      continue
    }
    out.push(
      JSON.stringify(n, (k, v: unknown) => (k === 'span' || CHILD_KEYS.has(k) ? undefined : v)),
    )
    for (const list of childLists(n).toReversed()) {
      stack.push(')')
      for (const c of list.toReversed()) stack.push(c)
      stack.push('(')
    }
  }
  return out
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
    shape(after.ast.body).join('\n') === shape(before.ast.body).join('\n') &&
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
