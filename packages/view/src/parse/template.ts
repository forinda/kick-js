/**
 * The `.kick` template parser: HTML-aware, because where a value lands
 * decides how it is escaped (spec §2). One pass over the source, with a stack
 * of open elements and blocks.
 */
import type {
  Attr,
  Ctx,
  Element,
  Expr,
  IfBranch,
  InputDecl,
  LoopVar,
  Node,
  TemplateAst,
} from '../ast'
import { error, warning, type Diagnostic, type Pos, type Span } from '../diagnostics'
import { parseExpression } from './expression'

export type { Attr, Element, Node, TemplateAst } from '../ast'

export interface ParseResult {
  ast: TemplateAst
  diagnostics: Diagnostic[]
}

const VOID = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
)
const RAW_TEXT = new Set(['script', 'style'])
const RCDATA = new Set(['title', 'textarea'])
/**
 * Inside SVG and MathML, these elements' children follow HTML rules again
 * (HTML integration points), so `<textarea>` under `<foreignObject>` is RCDATA.
 */
const INTEGRATION_POINTS = new Set(['foreignobject', 'desc', 'title', 'annotation-xml'])
const KEYWORDS =
  /^@(if|else|for|empty|switch|case|default|let|layout|input|slot|verbatim|assets)(?![\w$-])/
const LOOP_VARS = new Set<LoopVar>(['$index', '$first', '$last', '$even', '$odd', '$count'])

type Frame =
  | { type: 'root'; children: Node[] }
  | { type: 'element'; el: Element; children: Node[]; name: string }
  | { type: 'slot'; children: Node[] }
  | {
      type: 'block'
      children: Node[]
      /** What may follow its closing brace. */
      next?: 'else' | 'empty'
      node: Node
      keyword: string
      start: number
    }
  | { type: 'switch'; node: Extract<Node, { k: 'switch' }>; start: number }

class Fatal extends Error {}

class TemplateParser {
  private i = 0
  private text = ''
  private textStart = 0
  private seenOutput = false
  private readonly lineStarts: number[] = [0]
  readonly diagnostics: Diagnostic[] = []
  readonly ast: TemplateAst
  private readonly frames: Frame[]

  constructor(
    private readonly s: string,
    private readonly file: string,
  ) {
    for (let j = 0; j < s.length; j++) {
      const c = s.charCodeAt(j)
      if (c === 10 || (c === 13 && s.charCodeAt(j + 1) !== 10)) this.lineStarts.push(j + 1)
    }
    this.ast = { file, inputs: [], body: [] }
    this.frames = [{ type: 'root', children: this.ast.body }]
  }

  // ── positions and diagnostics ─────────────────────────────────────────

  pos(offset: number): Pos {
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.lineStarts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return { offset, line: lo + 1, column: offset - this.lineStarts[lo]! + 1 }
  }
  private span(start: number, end: number): Span {
    return { start: this.pos(start), end: this.pos(end) }
  }
  private err(start: number, end: number, message: string): void {
    this.diagnostics.push(error(this.file, this.span(start, end), message))
  }
  private warn(start: number, end: number, message: string): void {
    this.diagnostics.push(warning(this.file, this.span(start, end), message))
  }
  private fatal(start: number, end: number, message: string): never {
    this.err(start, end, message)
    throw new Fatal()
  }

  private expr(src: string, start: number): Expr | undefined {
    const r = parseExpression(src, this.file, this.pos(start))
    this.diagnostics.push(...r.diagnostics)
    return r.expr
  }

  // ── output ────────────────────────────────────────────────────────────

  private get top(): Frame {
    return this.frames[this.frames.length - 1]!
  }
  private children(): Node[] {
    const f = this.top
    if (f.type === 'switch') return []
    return f.children
  }
  private flush(): void {
    if (this.text) {
      if (/\S/.test(this.text)) this.seenOutput = true
      this.children().push({ k: 'text', value: this.text, span: this.span(this.textStart, this.i) })
      this.text = ''
    }
  }
  private emit(node: Node): void {
    this.flush()
    if (node.k !== 'let' && node.k !== 'slot-fill') this.seenOutput = true
    this.children().push(node)
  }
  private addText(chunk: string, at: number): void {
    if (!this.text) this.textStart = at
    this.text += chunk
  }

  private inPre(): boolean {
    return this.frames.some((f) => f.type === 'element' && f.name === 'pre')
  }

  /**
   * A block token alone on its line (only spaces or tabs around it) is
   * removed with its line break, so the output has no blank lines where the
   * template had `@if (…) {` and `}`. Returns where parsing continues.
   */
  private standalone(tokenStart: number, tokenEnd: number): number {
    if (this.inPre()) return tokenEnd
    let a = tokenStart
    while (a > 0 && (this.s[a - 1] === ' ' || this.s[a - 1] === '\t')) a--
    if (a > 0 && this.s[a - 1] !== '\n' && this.s[a - 1] !== '\r') return tokenEnd
    let b = tokenEnd
    while (b < this.s.length && (this.s[b] === ' ' || this.s[b] === '\t')) b++
    if (b < this.s.length && this.s[b] !== '\n' && this.s[b] !== '\r') return tokenEnd
    const lead = tokenStart - a
    if (lead && this.text.endsWith(this.s.slice(a, tokenStart))) {
      this.text = this.text.slice(0, -lead)
    }
    if (this.s[b] === '\r') b++
    if (this.s[b] === '\n') b++
    return b
  }

  // ── main loop ─────────────────────────────────────────────────────────

  run(): void {
    try {
      while (this.i < this.s.length) {
        if (this.top.type === 'switch') this.switchBody()
        else this.step()
      }
      this.flush()
      for (const f of this.frames) {
        if (f.type === 'block' || f.type === 'switch') {
          this.err(
            f.start,
            f.start + 1,
            `@${f.type === 'block' ? f.keyword : 'switch'} is never closed — expected }`,
          )
        }
      }
    } catch (e) {
      if (!(e instanceof Fatal)) throw e
    }
  }

  private step(): void {
    const s = this.s
    const i = this.i
    const c = s[i]!
    if (c === '{' && s.startsWith('{{--', i)) {
      const end = s.indexOf('--}}', i + 4)
      if (end < 0) this.fatal(i, i + 4, 'template comment is never closed — expected --}}')
      this.i = end + 4
      return
    }
    if (c === '{' && s[i + 1] === '{') {
      this.interp(i, 'text')
      return
    }
    if (c === '<') {
      if (s.startsWith('<!--', i)) return this.htmlComment(i)
      if (s[i + 1] === '/' && /[A-Za-z]/.test(s[i + 2] ?? '')) return this.closeTag(i)
      if (/[A-Za-z]/.test(s[i + 1] ?? '')) return this.openTag(i)
      if (s[i + 1] === '{') this.fatal(i, i + 2, "tag names can't be interpolated")
    }
    if (c === '@') {
      const m = KEYWORDS.exec(s.slice(i, i + 12))
      if (m && this.block(m[1]!, i)) return
    }
    if (c === '}' && this.frames.some((f) => f.type === 'block')) {
      this.closeBlock(i)
      return
    }
    this.addText(c, i)
    this.i++
  }

  // ── interpolation ─────────────────────────────────────────────────────

  /** `{{ expr }}` at `i`; returns the end offset. */
  private interpSource(i: number): { src: string; at: number; end: number } {
    const at = i + 2
    let j = at
    let quote = ''
    while (j < this.s.length) {
      const ch = this.s[j]!
      if (quote) {
        if (ch === '\\') j++
        else if (ch === quote) quote = ''
      } else if (ch === "'" || ch === '"') quote = ch
      else if (ch === '}' && this.s[j + 1] === '}') {
        return { src: this.s.slice(at, j), at, end: j + 2 }
      }
      j++
    }
    this.fatal(i, i + 2, 'interpolation is never closed — expected }}')
  }

  private interp(i: number, ctx: Ctx): void {
    const { src, at, end } = this.interpSource(i)
    const expr = this.expr(src, at)
    if (expr) this.emit({ k: 'interp', expr, ctx, span: this.span(i, end) })
    this.i = end
  }

  /** Text with `{{ }}` (raw text, rcdata, comments) up to `stop`. */
  private textWithInterps(from: number, stop: number, ctx: Ctx): Node[] {
    const out: Node[] = []
    let j = from
    let start = from
    while (j < stop) {
      if (this.s.startsWith('{{--', j)) {
        if (j > start)
          out.push({ k: 'text', value: this.s.slice(start, j), span: this.span(start, j) })
        const end = this.s.indexOf('--}}', j + 4)
        j = start = end < 0 || end > stop ? stop : end + 4
        continue
      }
      if (this.s.startsWith('{{', j)) {
        if (j > start)
          out.push({ k: 'text', value: this.s.slice(start, j), span: this.span(start, j) })
        const { src, at, end } = this.interpSource(j)
        const expr = this.expr(src, at)
        if (expr) out.push({ k: 'interp', expr, ctx, span: this.span(j, end) })
        j = start = end
        continue
      }
      j++
    }
    if (stop > start)
      out.push({ k: 'text', value: this.s.slice(start, stop), span: this.span(start, stop) })
    return out
  }

  private htmlComment(i: number): void {
    const end = this.s.indexOf('-->', i + 4)
    if (end < 0) this.fatal(i, i + 4, 'HTML comment is never closed — expected -->')
    this.emit({
      k: 'comment',
      children: this.textWithInterps(i + 4, end, 'comment'),
      span: this.span(i, end + 3),
    })
    this.i = end + 3
  }

  // ── tags ──────────────────────────────────────────────────────────────

  private openTag(i: number): void {
    const s = this.s
    const m = /^<([A-Za-z][\w:.-]*)/.exec(s.slice(i, i + 200))!
    const tag = m[1]!
    let j = i + m[0].length
    const parent = this.frames.findLast((f) => f.type === 'element') as
      | Extract<Frame, { type: 'element' }>
      | undefined
    const lower = tag.toLowerCase()
    const inForeign = !!parent?.el.foreign && !INTEGRATION_POINTS.has(parent.el.tag.toLowerCase())
    const foreign = inForeign || lower === 'svg' || lower === 'math'
    const attrs: Attr[] = []
    let selfClosing = false
    for (;;) {
      while (j < s.length && /\s/.test(s[j]!)) j++
      if (j >= s.length) this.fatal(i, i + m[0].length, `<${tag}> is never closed — expected >`)
      if (s[j] === '>') {
        j++
        break
      }
      if (s[j] === '/' && s[j + 1] === '>') {
        selfClosing = true
        j += 2
        break
      }
      j = this.attr(j, attrs)
    }
    this.i = j
    const name = foreign ? tag : lower
    const el: Element = {
      k: 'element',
      tag,
      attrs,
      children: [],
      foreign,
      void: !foreign && VOID.has(lower),
      selfClosing,
      span: this.span(i, j),
    }
    if (!foreign && lower === 'slot') {
      const nameAttr = attrs.find((a) => a.name === 'name')
      const slotName = nameAttr?.kind === 'static' ? String(nameAttr.parts?.[0] ?? '') : undefined
      if (nameAttr && nameAttr.kind !== 'static') {
        this.err(
          nameAttr.span.start.offset,
          nameAttr.span.end.offset,
          'a slot name must be plain text',
        )
      }
      const node: Node = { k: 'slot-outlet', name: slotName, fallback: [], span: el.span }
      this.emit(node)
      if (!selfClosing) this.frames.push({ type: 'slot', children: node.fallback })
      return
    }
    this.emit(el)
    if (el.void || selfClosing) return
    // `<script>` and `<style>` are raw text everywhere: a browser runs an SVG
    // `<script>` too, and HTML-escaping means nothing inside one.
    if (RAW_TEXT.has(lower) || (!foreign && RCDATA.has(lower))) {
      const close = s.toLowerCase().indexOf(`</${lower}`, j)
      const stop = close < 0 ? s.length : close
      el.children = this.textWithInterps(j, stop, RAW_TEXT.has(lower) ? 'raw-text' : 'rcdata')
      if (close < 0) {
        this.i = s.length
        return
      }
      const gt = s.indexOf('>', close)
      this.i = gt < 0 ? s.length : gt + 1
      return
    }
    this.frames.push({ type: 'element', el, children: el.children, name })
  }

  /** One attribute at `j`; returns where the next one starts. */
  private attr(j: number, attrs: Attr[]): number {
    const s = this.s
    const start = j
    if (s.startsWith('{{', j)) this.fatal(j, j + 2, "attribute names can't be interpolated")
    while (j < s.length && !/[\s"'>/=]/.test(s[j]!)) {
      if (s.startsWith('{{', j)) this.fatal(j, j + 2, "attribute names can't be interpolated")
      j++
    }
    if (j === start) this.fatal(j, j + 1, `unexpected '${s[j]}' in a tag`)
    const raw = s.slice(start, j)
    let k = j
    while (k < s.length && /[ \t]/.test(s[k]!)) k++
    if (s[k] !== '=') {
      attrs.push(this.classify(raw, undefined, start, j, false))
      return j
    }
    k++
    while (k < s.length && /\s/.test(s[k]!)) k++
    const q = s[k]
    if (q === '"' || q === "'") {
      const close = s.indexOf(q, k + 1)
      if (close < 0) this.fatal(start, k + 1, `the value of ${raw} is never closed — expected ${q}`)
      attrs.push(this.classify(raw, { from: k + 1, to: close }, start, close + 1, true))
      return close + 1
    }
    let e = k
    while (e < s.length && !/[\s>]/.test(s[e]!)) e++
    if (s.slice(k, e).includes('{{')) {
      this.fatal(k, e, `quote the value of ${raw}: an interpolated attribute must be in quotes`)
    }
    attrs.push(this.classify(raw, { from: k, to: e }, start, e, false))
    return e
  }

  private classify(
    raw: string,
    value: { from: number; to: number } | undefined,
    start: number,
    end: number,
    quoted: boolean,
  ): Attr {
    const span = this.span(start, end)
    const binding = /^\[(?:(class)\.([\w-]+)|(style)\.([\w-]+)(?:\.(\w+))?|([^\]]+))\]$/.exec(raw)
    if (binding) {
      if (!value) this.fatal(start, end, `${raw} needs a value: ${raw}="expression"`)
      const src = this.s.slice(value.from, value.to)
      if (src.includes('{{'))
        this.fatal(value.from, value.to, `${raw} takes an expression, without {{ }}`)
      const expr = this.expr(src, value.from)
      const [, cls, clsName, sty, styName, unit, bind] = binding
      if (cls) return { name: clsName!, kind: 'class', expr, quoted, span }
      if (sty) return { name: styName!, kind: 'style', expr, unit, quoted, span }
      return { name: bind!, kind: 'bind', expr, quoted, span }
    }
    if (!value) return { name: raw, kind: 'bare', quoted: false, span }
    const parts: Array<string | Expr> = []
    for (const n of this.textWithInterps(value.from, value.to, 'text')) {
      if (n.k === 'text') parts.push(n.value)
      else if (n.k === 'interp') parts.push(n.expr)
    }
    const dynamic = parts.some((p) => typeof p !== 'string')
    return {
      name: raw,
      kind: dynamic ? 'interp' : 'static',
      parts: parts.length ? parts : [''],
      quoted,
      span,
    }
  }

  private closeTag(i: number): void {
    const m = /^<\/([A-Za-z][\w:.-]*)\s*>/.exec(this.s.slice(i, i + 200))
    if (!m) this.fatal(i, i + 2, 'malformed closing tag')
    this.i = i + m[0].length
    const tag = m[1]!
    for (let f = this.frames.length - 1; f > 0; f--) {
      const frame = this.frames[f]!
      if (frame.type === 'block' || frame.type === 'switch' || frame.type === 'root') break
      const matches =
        frame.type === 'slot'
          ? tag.toLowerCase() === 'slot'
          : frame.el.foreign
            ? frame.name === tag
            : frame.name === tag.toLowerCase()
      if (matches) {
        this.flush()
        this.frames.length = f
        return
      }
    }
    this.warn(i, this.i, `</${tag}> closes nothing`)
  }

  // ── blocks ────────────────────────────────────────────────────────────

  /** `( … )` from `j` (at `(`): the inside and the offset after `)`. */
  private parens(j: number, what: string): { src: string; at: number; end: number } {
    if (this.s[j] !== '(') this.fatal(j, j + 1, `expected ( after ${what}`)
    let depth = 0
    let quote = ''
    for (let k = j; k < this.s.length; k++) {
      const ch = this.s[k]!
      if (quote) {
        if (ch === '\\') k++
        else if (ch === quote) quote = ''
        continue
      }
      if (ch === "'" || ch === '"') quote = ch
      else if (ch === '(') depth++
      else if (ch === ')' && --depth === 0)
        return { src: this.s.slice(j + 1, k), at: j + 1, end: k + 1 }
    }
    this.fatal(j, j + 1, `${what} ( is never closed — expected )`)
  }

  private skipWs(j: number): number {
    while (j < this.s.length && /\s/.test(this.s[j]!)) j++
    return j
  }

  private openBrace(j: number, what: string): number {
    j = this.skipWs(j)
    if (this.s[j] !== '{') this.fatal(j, j + 1, `expected { after ${what}`)
    return j + 1
  }

  /** Split a block header on top-level `;`. */
  private splitHeader(src: string, at: number): Array<{ src: string; at: number }> {
    const out: Array<{ src: string; at: number }> = []
    let quote = ''
    let start = 0
    for (let k = 0; k < src.length; k++) {
      const ch = src[k]!
      if (quote) {
        if (ch === '\\') k++
        else if (ch === quote) quote = ''
      } else if (ch === "'" || ch === '"') quote = ch
      else if (ch === ';') {
        out.push({ src: src.slice(start, k), at: at + start })
        start = k + 1
      }
    }
    out.push({ src: src.slice(start), at: at + start })
    return out
  }

  private stringArg(src: string, at: number, what: string): string {
    const m = /^\s*(['"])([^'"]*)\1\s*$/.exec(src)
    if (!m) this.fatal(at, at + src.length, `${what} takes a quoted name`)
    return m[2]!
  }

  /** Handle `@keyword` at `i`. False when it isn't a block after all (stays text). */
  private block(kw: string, i: number): boolean {
    const s = this.s
    const after = i + 1 + kw.length
    const next = this.skipWs(after)
    const ch = s[next]
    switch (kw) {
      case 'if':
      case 'for':
      case 'switch':
      case 'slot':
      case 'layout':
      case 'assets':
        if (ch !== '(') return false
        break
      case 'verbatim':
        if (ch !== '{') return false
        break
      case 'let':
      case 'input':
        if (!/[ \t]/.test(s[after] ?? '')) return false
        break
      case 'else':
      case 'empty':
      case 'case':
      case 'default':
        if (ch !== '{' && ch !== '(' && !(kw === 'else' && s.startsWith('if', next))) return false
        this.fatal(
          i,
          after,
          `@${kw} has no matching ${kw === 'else' ? '@if' : kw === 'empty' ? '@for' : '@switch'}`,
        )
    }

    if (kw === 'layout') return this.layout(i, next)
    if (kw === 'input') return this.input(i, after)
    if (kw === 'let') return this.let(i, after)
    if (kw === 'verbatim') return this.verbatim(i, next)
    if (kw === 'assets') {
      const p = this.parens(next, '@assets')
      const entry = this.stringArg(p.src, p.at, '@assets')
      this.i = this.standalone(i, p.end)
      this.emit({ k: 'assets', entry, span: this.span(i, p.end) })
      return true
    }

    const p = this.parens(next, `@${kw}`)
    const brace = this.openBrace(p.end, `@${kw} (…)`)
    const resume = this.standalone(i, brace)
    if (kw === 'if') {
      const branch = this.ifBranch(p.src, p.at)
      const node: Node = { k: 'if', branches: [branch], span: this.span(i, brace) }
      this.emit(node)
      this.frames.push({
        type: 'block',
        children: branch.body,
        next: 'else',
        node,
        keyword: 'if',
        start: i,
      })
    } else if (kw === 'for') {
      const node = this.forHeader(p.src, p.at, i, brace)
      this.emit(node)
      this.frames.push({
        type: 'block',
        children: node.body,
        next: 'empty',
        node,
        keyword: 'for',
        start: i,
      })
    } else if (kw === 'switch') {
      const on = this.expr(p.src, p.at)
      const node: Extract<Node, { k: 'switch' }> = {
        k: 'switch',
        on: on ?? { kind: 'literal', value: null, span: this.span(p.at, p.at) },
        cases: [],
        span: this.span(i, brace),
      }
      this.emit(node)
      this.frames.push({ type: 'switch', node, start: i })
    } else {
      const name = this.stringArg(p.src, p.at, '@slot')
      const node: Node = { k: 'slot-fill', name, body: [], span: this.span(i, brace) }
      this.emit(node)
      this.frames.push({ type: 'block', children: node.body, node, keyword: 'slot', start: i })
    }
    this.i = resume
    return true
  }

  private ifBranch(src: string, at: number): IfBranch {
    const parts = this.splitHeader(src, at)
    const cond = this.expr(parts[0]!.src, parts[0]!.at)
    const branch: IfBranch = { cond, body: [] }
    if (parts[1]) {
      const m = /^\s*as\s+([A-Za-z_$][\w$]*)\s*$/.exec(parts[1].src)
      if (!m) this.err(parts[1].at, parts[1].at + parts[1].src.length, 'expected `as name` after ;')
      else branch.alias = m[1]
    }
    if (parts.length > 2) this.err(parts[2]!.at, parts[2]!.at + 1, 'unexpected ; in @if')
    return branch
  }

  private forHeader(
    src: string,
    at: number,
    start: number,
    end: number,
  ): Extract<Node, { k: 'for' }> {
    const parts = this.splitHeader(src, at)
    const head = parts[0]!
    const m =
      /^(\s*)(?:\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]|([A-Za-z_$][\w$]*))\s+of\s+/.exec(
        head.src,
      )
    if (!m) this.fatal(head.at, head.at + head.src.length, '@for needs `item of items`')
    const item: string | [string, string] = m[4] ?? [m[2]!, m[3]!]
    const ofSrc = head.src.slice(m[0].length)
    const of = this.expr(ofSrc, head.at + m[0].length) ?? {
      kind: 'literal',
      value: null,
      span: this.span(at, at),
    }
    const lets: Record<string, LoopVar> = {}
    for (const part of parts.slice(1)) {
      const t = part.src.trim()
      if (t.startsWith('track')) {
        this.expr(
          part.src.replace(/^\s*track\b/, (w) => ' '.repeat(w.length)),
          part.at,
        )
        continue
      }
      if (t.startsWith('let')) {
        const body = part.src.replace(/^\s*let\b/, '')
        for (const decl of body.split(',')) {
          const d = /^\s*([A-Za-z_$][\w$]*)\s*=\s*(\$\w+)\s*$/.exec(decl)
          if (!d || !LOOP_VARS.has(d[2] as LoopVar)) {
            this.err(
              part.at,
              part.at + part.src.length,
              `unknown loop variable in \`${decl.trim()}\` — use ${[...LOOP_VARS].join(', ')}`,
            )
            continue
          }
          lets[d[1]!] = d[2] as LoopVar
        }
        continue
      }
      this.err(part.at, part.at + part.src.length, `expected track or let in @for, found \`${t}\``)
    }
    return { k: 'for', item, of, lets, body: [], span: this.span(start, end) }
  }

  private closeBlock(i: number): void {
    let f = this.frames.length - 1
    while (this.frames[f]!.type !== 'block') f--
    const frame = this.frames[f] as Extract<Frame, { type: 'block' }>
    const s = this.s
    // A continuation: `} @else …`, `} @empty {`.
    const j = this.skipWs(i + 1)
    let branch: IfBranch | undefined
    let empty = false
    let end = i + 1
    if (frame.next === 'else' && /^@else(?![\w$-])/.test(s.slice(j, j + 6))) {
      let k = this.skipWs(j + 5)
      if (s.startsWith('if', k) && /[\s(]/.test(s[k + 2] ?? '')) {
        const p = this.parens(this.skipWs(k + 2), '@else if')
        branch = this.ifBranch(p.src, p.at)
        k = p.end
      } else {
        branch = { body: [] }
      }
      end = this.openBrace(k, '@else')
    } else if (frame.next === 'empty' && /^@empty(?![\w$-])/.test(s.slice(j, j + 7))) {
      empty = true
      end = this.openBrace(j + 6, '@empty')
    }
    // Trim before flushing: the indentation in front of `}` is still pending.
    const resume = this.standalone(i, end)
    this.flush()
    // Elements opened inside the block close with it.
    this.frames.length = f
    this.i = resume
    if (branch) {
      const node = frame.node as Extract<Node, { k: 'if' }>
      node.branches.push(branch)
      this.frames.push({
        type: 'block',
        children: branch.body,
        next: branch.cond ? 'else' : undefined,
        node,
        keyword: 'else',
        start: j,
      })
    } else if (empty) {
      const node = frame.node as Extract<Node, { k: 'for' }>
      node.empty = []
      this.frames.push({ type: 'block', children: node.empty, node, keyword: 'empty', start: j })
    }
  }

  /** Inside `@switch { }`: only `@case (…) { }`, `@default { }` and whitespace. */
  private switchBody(): void {
    const s = this.s
    const j = this.skipWs(this.i)
    const frame = this.top as Extract<Frame, { type: 'switch' }>
    if (j >= s.length) {
      this.i = j
      return
    }
    if (s[j] === '}') {
      this.frames.pop()
      this.i = this.standalone(j, j + 1)
      return
    }
    const m = /^@(case|default)(?![\w$-])/.exec(s.slice(j, j + 9))
    if (!m) this.fatal(j, j + 1, 'only @case and @default go inside @switch')
    let k = j + m[0].length
    let value: Expr | undefined
    if (m[1] === 'case') {
      const p = this.parens(this.skipWs(k), '@case')
      value = this.expr(p.src, p.at)
      k = p.end
    } else if (frame.node.default) {
      this.err(j, k, '@switch has two @default blocks')
    }
    const brace = this.openBrace(k, `@${m[1]}`)
    const body: Node[] = []
    if (m[1] === 'case') frame.node.cases.push({ value: value ?? frame.node.on, body })
    else frame.node.default = body
    this.i = this.standalone(j, brace)
    this.frames.push({ type: 'block', children: body, node: frame.node, keyword: m[1]!, start: j })
  }

  private verbatim(i: number, brace: number): boolean {
    let depth = 0
    let quote = ''
    for (let k = brace; k < this.s.length; k++) {
      const ch = this.s[k]!
      if (quote) {
        if (ch === '\\') k++
        else if (ch === quote) quote = ''
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch
      else if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) {
        const resume = this.standalone(i, k + 1)
        this.emit({ k: 'verbatim', text: this.s.slice(brace + 1, k), span: this.span(i, k + 1) })
        this.i = resume
        return true
      }
    }
    this.fatal(i, brace + 1, '@verbatim is never closed — expected }')
  }

  private layout(i: number, at: number): boolean {
    const p = this.parens(at, '@layout')
    if (this.seenOutput || this.frames.length > 1) {
      this.err(i, p.end, '@layout must come before any output')
    } else if (this.ast.layout !== undefined) {
      this.err(i, p.end, 'a template has one @layout')
    } else {
      this.ast.layout = /^\s*none\s*$/.test(p.src) ? null : this.stringArg(p.src, p.at, '@layout')
      this.ast.layoutSpan = this.span(i, p.end)
    }
    this.i = this.standalone(i, p.end)
    return true
  }

  private input(i: number, after: number): boolean {
    let eol = this.s.indexOf('\n', after)
    if (eol < 0) eol = this.s.length
    const line = this.s.slice(after, eol).replace(/\r$/, '')
    const m = /^\s*([A-Za-z_$][\w$]*)\s*(?:=\s*(.*?))?\s*$/.exec(line)
    if (!m) this.fatal(i, eol, '@input needs a name: @input name or @input name = value')
    if (this.frames.length > 1)
      this.err(i, eol, '@input goes at the top of a component, outside any block')
    const decl: InputDecl = { name: m[1]!, span: this.span(i, after + line.length) }
    if (m[2] !== undefined) {
      const at = after + line.indexOf(m[2], m[0].indexOf('=') + 1)
      const e = this.expr(m[2], at)
      const literal =
        e?.kind === 'literal'
          ? e.value
          : e?.kind === 'unary' &&
              e.op === '-' &&
              e.arg.kind === 'literal' &&
              typeof e.arg.value === 'number'
            ? -e.arg.value
            : undefined
      if (e && literal === undefined) {
        this.err(
          at,
          at + m[2].length,
          'an @input default must be a literal: a string, number, true, false or null',
        )
      } else if (e) {
        decl.default = { value: literal!, span: e.span }
      }
    }
    if (this.ast.inputs.some((d) => d.name === decl.name))
      this.err(i, eol, `@input ${decl.name} is declared twice`)
    this.ast.inputs.push(decl)
    this.i = this.standalone(i, after + line.length)
    return true
  }

  private let(i: number, after: number): boolean {
    let quote = ''
    for (let k = after; k < this.s.length; k++) {
      const ch = this.s[k]!
      if (quote) {
        if (ch === '\\') k++
        else if (ch === quote) quote = ''
        continue
      }
      if (ch === "'" || ch === '"') quote = ch
      else if (ch === ';') {
        const src = this.s.slice(after, k)
        const m = /^\s*([A-Za-z_$][\w$]*)\s*=/.exec(src)
        if (!m) this.fatal(i, k, '@let needs a name: @let name = expression;')
        const expr = this.expr(src.slice(m[0].length), after + m[0].length)
        const resume = this.standalone(i, k + 1)
        if (expr) this.emit({ k: 'let', name: m[1]!, expr, span: this.span(i, k + 1) })
        this.i = resume
        return true
      }
    }
    this.fatal(i, after, '@let is never ended — expected ;')
  }
}

/** Parse a `.kick` source. A leading BOM is dropped; positions refer to the rest. */
export function parse(source: string, file: string): ParseResult {
  const p = new TemplateParser(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source, file)
  p.run()
  return { ast: p.ast, diagnostics: p.diagnostics }
}
