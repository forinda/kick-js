/**
 * `check`: turn a parsed template into a checked one — names resolved,
 * pipes, components, slots and layouts verified, and every interpolation's
 * context enforced. What passes here is safe to render.
 */
import { FORM_GLOBALS, SECRET_FIELD } from '../form-state'
import { parseValidate, VALIDATORS_TAG } from '../validators'
import {
  AST_FORMAT_VERSION,
  type Attr,
  type CAttr,
  type CExpr,
  type CFill,
  type CNode,
  type CSnippet,
  type CSeg,
  type CheckedFragment,
  type CheckedTemplate,
  type Element,
  type Literal,
  type Expr,
  type LoopVar,
  type Node,
  type TemplateAst,
} from '../ast'
import { error, warning, type Diagnostic, type Span } from '../diagnostics'
import { decodeEntities } from '../entities'
import { isUrlAttr } from '../urls'
import {
  componentTag,
  configuredLayouts,
  isComponent,
  layoutResolver,
  resolveRef,
  templateName,
  type Project,
} from './project'
import { optimize } from './optimize'

export type { CheckedTemplate } from '../ast'

/** What `check` returns: `template` is absent when any diagnostic is an error. */
export interface CheckResult {
  template?: CheckedTemplate
  diagnostics: Diagnostic[]
}

/** SVG animation elements can set any attribute — `href` included — to these values. */
const ANIMATION = new Set(['animate', 'set', 'animatemotion', 'animatetransform'])
const ANIMATION_VALUES = new Set(['values', 'to', 'from', 'by', 'attributename'])

const JSON_SCRIPT_TYPES = new Set(['application/json', 'application/ld+json'])
/** Input types that never refill. */
const NO_REFILL = new Set(['password', 'file', 'hidden', 'submit', 'button', 'reset', 'image'])

/** `$old?.[name]` */
function oldOf(name: string): CExpr {
  return { k: 'd', n: '$old', p: [{ e: { k: 'l', v: name }, o: 1 }] }
}

/** `e == value` */
function equals(e: CExpr, value: CExpr): CExpr {
  return { k: 'b', o: '==', l: e, r: value }
}

const LOOP_VARS: ReadonlySet<string> = new Set([
  '$index',
  '$first',
  '$last',
  '$even',
  '$odd',
  '$count',
])

/** Attributes on a component tag that go to its root element instead of being inputs. */
const isFallthrough = (a: Attr): boolean => {
  if (a.kind === 'class' || a.kind === 'style') return true
  const n = a.name.toLowerCase()
  return (
    ['class', 'id', 'style', 'role'].includes(n) || n.startsWith('aria-') || n.startsWith('data-')
  )
}

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

type Binding = { kind: 'slot'; s: number } | { kind: 'meta'; s: number; w?: LoopVar }

/** What a caller needs to know about a component without checking it. */
interface Signature {
  name: string
  inputs: Map<string, { required: boolean; def?: unknown }>
  /** Slot names, each with the value names it offers. */
  outlets: Map<string, string[]>
  /** Root nodes, not counting a lifted `<script client>`. */
  roots: number
  /** The single root, when there is one: where forwarded attributes go. */
  root?:
    | { k: 'el'; tag: string; /** for a `<component>` root: its candidate tags */ of?: string[] }
    | { k: 'cmp'; name: string }
    | { k: 'slot' }
}

/**
 * Attributes never forwarded to a root of this tag: their check depends on the
 * root's other attributes, which the call site can't see. A form field decides
 * `$old` refill from them; a `<meta>`'s `content` is a URL when `http-equiv` is
 * refresh.
 */
const FIELD_GUARDED = new Set(['type', 'name', 'value', 'checked', 'validate'])
const GUARDED: Record<string, ReadonlySet<string>> = {
  input: FIELD_GUARDED,
  select: FIELD_GUARDED,
  textarea: FIELD_GUARDED,
  option: FIELD_GUARDED,
  meta: new Set(['http-equiv', 'content']),
  // A script's `type` decides how `{{ }}` inside it is checked.
  script: new Set(['type']),
}

/** Edit distance, for "did you mean" — small strings only. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]!
}

/** The declared input `name` most likely misspells (within 2 edits), if any. */
export function nearInput(name: string, inputs: Iterable<string>): string | undefined {
  if (/^(hx-|x-|aria-|data-|@|:)/i.test(name)) return undefined
  const want = camel(name).toLowerCase()
  for (const input of inputs) {
    if (distance(want, input.toLowerCase()) <= 2) return input
  }
  return undefined
}

class Checker {
  readonly diagnostics: Diagnostic[] = []
  slots = 0
  private readonly scopes: Array<Map<string, Binding>> = [new Map()]
  private readonly loops: number[] = []
  private readonly warned = new Set<string>()
  private readonly stackNames = new Set<string>()
  /** Per slot name: the value names it offers (sorted), to keep them consistent. */
  private readonly offered = new Map<string, string>()
  /** Inside a `@push` body, where a `<stack>` would be filled into the wrong buffer. */
  private inPush = 0
  /** The template's `@snippet`s: their parameters, known before any body is compiled. */
  readonly snippetDefs = new Map<string, Array<{ name: string; default?: unknown }>>()
  // Null prototype: any identifier is a snippet name.
  readonly snippets: Record<string, CSnippet> = Object.create(null)
  /** Top-level `@let` names: a snippet can't read them (it may run before they do). */
  readonly topLets = new Set<string>()
  private inSnippet = false
  /** Compiling a `<component>`'s content again, for its second and later candidates. */
  /** Each `@fragment`'s standalone unit, by name. */
  // Null prototype: `constructor`, `toString` and `__proto__` are fragment names too.
  readonly fragments: Record<string, CheckedFragment> = Object.create(null)
  /**
   * Set while compiling a fragment's standalone unit: the names enclosing
   * blocks bound (read from data there, and recorded as needs), and whether
   * it sits in a loop (whose `$index` etc. it can't read).
   */
  private unit?: { outer: Set<string>; inLoop: boolean; needs: string[]; errors: Diagnostic[] }
  private readonly tags = new Map<string, string[]>()
  private readonly signatures = new Map<string, Signature>()

  constructor(
    private readonly project: Project,
    private readonly ast: TemplateAst,
    private readonly component: boolean,
  ) {
    for (const name of project.templates.keys()) {
      if (!isComponent(name, project.componentsDir)) continue
      const tag = componentTag(name, project.componentsDir)
      this.tags.set(tag, [...(this.tags.get(tag) ?? []), name])
    }
  }

  private err(span: Span, message: string): void {
    this.diagnostics.push(error(this.ast.file, span, message))
  }
  private warn(span: Span, message: string): void {
    this.diagnostics.push(warning(this.ast.file, span, message))
  }

  // ── scope ─────────────────────────────────────────────────────────────

  private slot(): number {
    return this.slots++
  }
  bind(name: string, b: Binding): void {
    this.scopes[this.scopes.length - 1]!.set(name, b)
  }
  private lookup(name: string): Binding | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const b = this.scopes[i]!.get(name)
      if (b) return b
    }
    return undefined
  }
  private scoped<T>(fn: () => T): T {
    this.scopes.push(new Map())
    try {
      return fn()
    } finally {
      this.scopes.pop()
    }
  }

  // ── expressions ───────────────────────────────────────────────────────

  /**
   * `whole` is true only for the whole expression of a text `{{ }}` or of a
   * `<style>`'s content — the places `raw` may appear (as its outermost pipe). Nested anywhere else, raw
   * could smuggle markup into an attribute or another context.
   */
  expr(e: Expr, where: 'text' | 'attr' | 'rcdata' | 'json' | 'css' = 'text', whole = false): CExpr {
    switch (e.kind) {
      case 'literal':
        return { k: 'l', v: e.value }
      case 'unary':
        return { k: 'u', o: e.op, a: this.expr(e.arg) }
      case 'binary':
      case 'logical':
        return { k: 'b', o: e.op, l: this.expr(e.left), r: this.expr(e.right) }
      case 'conditional':
        return { k: 'c', t: this.expr(e.test), y: this.expr(e.whenTrue), n: this.expr(e.whenFalse) }
      case 'pipe': {
        if (!this.project.pipes.has(e.name)) this.err(e.span, `unknown pipe '${e.name}'`)
        if (e.name === 'raw' && !(whole && (where === 'text' || where === 'css'))) {
          this.err(
            e.span,
            where === 'attr'
              ? "raw isn't allowed in an attribute: it could break out of the quotes"
              : where === 'text' || where === 'css'
                ? 'raw must be the last pipe of the whole {{ }}: {{ value | raw }}'
                : `raw isn't allowed inside <${where === 'rcdata' ? 'title> or <textarea' : 'script'}>`,
          )
        }
        return { k: 'p', n: e.name, i: this.expr(e.input), a: e.args.map((a) => this.expr(a)) }
      }
      case 'path': {
        const p: CSeg[] = e.segments.map((s) => {
          const seg: CSeg = s.computed ? { e: this.expr(s.computed) } : { n: s.name! }
          if (s.optional) seg.o = 1
          return seg
        })
        if (LOOP_VARS.has(e.root) && this.unit?.inLoop && !this.loops.length) {
          this.unit.errors.push(
            error(
              this.ast.file,
              e.span,
              `'${e.root}' comes from the @for around this fragment — alias it (let i = ${e.root}) and pass i`,
            ),
          )
          return { k: 'x' }
        }
        if (LOOP_VARS.has(e.root)) {
          const loop = this.loops[this.loops.length - 1]
          if (loop === undefined) {
            this.err(e.span, `${e.root} is only available inside @for`)
            return { k: 'x' }
          }
          return { k: 'm', s: loop, w: e.root as LoopVar }
        }
        const b = this.lookup(e.root)
        if (b?.kind === 'meta') return { k: 'm', s: b.s, w: b.w! }
        if (b) return { k: 'v', s: b.s, p }
        if (this.inSnippet && this.topLets.has(e.root)) {
          this.err(
            e.span,
            `'${e.root}' is a top-level @let, which a snippet can't read — pass it as a parameter`,
          )
          return { k: 'x' }
        }
        if (this.unit?.outer.has(e.root)) {
          if (!this.unit.needs.includes(e.root)) this.unit.needs.push(e.root)
          return { k: 'd', n: e.root, p }
        }
        // Form state is request-wide: a form field component reads it too.
        if (FORM_GLOBALS.has(e.root)) return { k: 'd', n: e.root, p }
        if (this.component) {
          if (!this.warned.has(e.root)) {
            this.warned.add(e.root)
            this.warn(
              e.span,
              `'${e.root}' isn't an input of this component — declare it with @input ${e.root}`,
            )
          }
          return { k: 'x' }
        }
        return { k: 'd', n: e.root, p }
      }
    }
  }

  // ── nodes ─────────────────────────────────────────────────────────────

  nodes(list: Node[], parent?: Element): CNode[] {
    const out: CNode[] = []
    // Elements are walked with an explicit stack, so deeply nested markup
    // can't overflow the call stack; blocks and components still recurse.
    const stack: Array<{ list: Node[]; i: number; parent?: Element; close?: string }> = [
      { list, i: 0, parent },
    ]
    while (stack.length) {
      const f = stack[stack.length - 1]!
      if (f.i >= f.list.length) {
        stack.pop()
        // The <select>'s own frame, not a block's walk of its children.
        if (f.close && f.parent?.tag.toLowerCase() === 'select') this.select = undefined
        if (f.close) out.push({ k: 's', t: f.close })
        continue
      }
      const n = f.list[f.i++]!
      if (n.k !== 'element') {
        this.node(n, out, f.parent)
        continue
      }
      const open = this.element(n, out)
      if (open) stack.push({ list: open.children, i: 0, parent: open, close: `</${open.tag}>` })
    }
    return out
  }

  private node(n: Node, out: CNode[], parent?: Element): void {
    switch (n.k) {
      case 'text':
        out.push({ k: 's', t: n.value })
        return
      case 'interp': {
        if (n.ctx === 'comment') {
          this.err(
            n.span,
            "{{ }} isn't allowed inside an HTML comment — use {{-- --}} for a template comment",
          )
          return
        }
        if (n.ctx === 'raw-text') {
          out.push(...this.rawText(n, parent))
          return
        }
        out.push({
          k: 'i',
          c: n.ctx === 'rcdata' ? 'rcdata' : 'text',
          e: this.expr(n.expr, n.ctx === 'rcdata' ? 'rcdata' : 'text', true),
          at: at(n.span),
        })
        return
      }
      case 'comment':
        for (const c of n.children) {
          if (c.k === 'interp') this.node(c, out)
        }
        out.push({
          k: 's',
          t: `<!--${n.children.map((c) => (c.k === 'text' ? c.value : '')).join('')}-->`,
        })
        return
      case 'element': {
        const open = this.element(n, out)
        if (open) out.push(...this.nodes(open.children, open), { k: 's', t: `</${open.tag}>` })
        return
      }
      case 'if':
        out.push({
          k: 'if',
          br: n.branches.map((b) =>
            this.scoped(() => {
              const cond = b.cond && this.expr(b.cond)
              let alias: number | undefined
              if (b.alias) {
                alias = this.slot()
                this.bind(b.alias, { kind: 'slot', s: alias })
              }
              const br: { c?: CExpr; a?: number; b: CNode[] } = { b: this.nodes(b.body, parent) }
              if (cond) br.c = cond
              if (alias !== undefined) br.a = alias
              return br
            }),
          ),
        })
        return
      case 'for': {
        const e = this.expr(n.of)
        const m = this.slot()
        let it: number | [number, number]
        const body = this.scoped(() => {
          if (typeof n.item === 'string') {
            it = this.slot()
            this.bind(n.item, { kind: 'slot', s: it })
          } else {
            it = [this.slot(), this.slot()]
            this.bind(n.item[0], { kind: 'slot', s: it[0] })
            this.bind(n.item[1], { kind: 'slot', s: it[1] })
          }
          for (const [name, w] of Object.entries(n.lets)) this.bind(name, { kind: 'meta', s: m, w })
          this.loops.push(m)
          try {
            return this.nodes(n.body, parent)
          } finally {
            this.loops.pop()
          }
        })
        const node: Extract<CNode, { k: 'for' }> = {
          k: 'for',
          e,
          it: it!,
          m,
          b: body,
          at: at(n.span),
        }
        if (n.empty) node.em = this.scoped(() => this.nodes(n.empty!, parent))
        out.push(node)
        return
      }
      case 'switch': {
        const node: CNode = {
          k: 'sw',
          e: this.expr(n.on),
          cs: n.cases.map((c) => ({
            e: this.expr(c.value),
            b: this.scoped(() => this.nodes(c.body, parent)),
          })),
        }
        if (n.default) node.d = this.scoped(() => this.nodes(n.default!, parent))
        out.push(node)
        return
      }
      case 'let': {
        const e = this.expr(n.expr)
        const s = this.slot()
        if (this.scopes[this.scopes.length - 1]!.has(n.name))
          this.err(n.span, `@let ${n.name} is declared twice here`)
        this.bind(n.name, { kind: 'slot', s })
        out.push({ k: 'let', s, e })
        return
      }
      case 'verbatim':
        out.push({ k: 's', t: n.text })
        return
      case 'slot-outlet': {
        const name = n.name ?? ''
        const key = n.offers
          .map((o) => o.name)
          .toSorted()
          .join(', ')
        const prev = this.offered.get(name)
        if (prev !== undefined && prev !== key) {
          this.err(
            n.span,
            `slot '${name || 'default'}' offers ${key || 'nothing'} here but ${prev || 'nothing'} elsewhere — offer the same names everywhere`,
          )
        }
        this.offered.set(name, key)
        const v = n.offers.map((o) => ({ n: o.name, e: this.expr(o.expr) }))
        // The fallback reads the offered values too.
        const fs: number[] = []
        const fb = this.scoped(() => {
          for (const o of n.offers) {
            const s = this.slot()
            fs.push(s)
            this.bind(o.name, { kind: 'slot', s })
          }
          return this.nodes(n.fallback, parent)
        })
        out.push({ k: 'o', n: name, fb, ...(v.length ? { v, fs } : {}) })
        return
      }
      case 'slot-fill':
        this.err(
          n.span,
          "@slot('…') { } goes at the top of a page with a layout, or inside a component tag",
        )
        return
      case 'assets':
        out.push({ k: 'as', en: n.entry })
        return
      case 'fragment':
        this.fragment(n, out, parent)
        return
      case 'snippet':
        // Only reachable nested, which the parser reports.
        return
      case 'render': {
        // A snippet body is checked as HTML; inside SVG/MathML its markup
        // would parse differently (e.g. <style> content as elements).
        if (parent?.foreign) {
          this.err(n.span, "@render can't go inside <svg> or <math>: render the snippet outside it")
          return
        }
        const params = this.snippetDefs.get(n.name)
        if (!params) {
          this.err(
            n.span,
            `no snippet '${n.name}' in this template — it has ${[...this.snippetDefs.keys()].join(', ') || 'none'}`,
          )
          return
        }
        const required = params.filter((p) => p.default === undefined).length
        if (n.args.length < required || n.args.length > params.length) {
          const range = required === params.length ? `${required}` : `${required}–${params.length}`
          this.err(n.span, `@render ${n.name} takes ${range} argument(s), got ${n.args.length}`)
          return
        }
        out.push({ k: 'rnd', n: n.name, a: n.args.map((a) => this.expr(a)), at: at(n.span) })
        return
      }
      case 'push': {
        this.inPush++
        try {
          out.push({ k: 'push', n: n.name, b: this.scoped(() => this.nodes(n.body, parent)) })
        } finally {
          this.inPush--
        }
        return
      }
      case 'stack':
        if (n.children.some((c) => c.k !== 'text' || c.value.trim())) {
          this.err(n.span, "<stack> can't have content: @push adds it")
          return
        }
        if (this.component) {
          this.err(n.span, '<stack> goes in a page or layout, not in components')
          return
        }
        if (this.inPush) {
          this.err(n.span, "<stack> can't go inside @push: put it in the layout itself")
          return
        }
        if (this.stackNames.has(n.name)) {
          this.warn(
            n.span,
            `stack '${n.name}' is already placed above: only the first one is filled`,
          )
        }
        this.stackNames.add(n.name)
        out.push({ k: 'stk', n: n.name })
    }
  }

  /**
   * `@fragment('name') { }`: its body in place, as if unwrapped, and — outside
   * another fragment's unit — compiled again as a standalone unit, where the
   * names enclosing blocks bound become data the caller passes.
   */
  private fragment(n: Extract<Node, { k: 'fragment' }>, out: CNode[], parent?: Element): void {
    if (this.component) {
      this.err(n.span, "fragments aren't allowed in components")
      return
    }
    if (this.inSnippet) {
      this.err(
        n.span,
        "a @fragment can't go inside a @snippet: put the @render inside the fragment",
      )
      return
    }
    out.push(...this.scoped(() => this.nodes(n.body, parent)))
    // Inside another fragment's unit: inline only; its unit is compiled once.
    if (this.unit) return
    if (n.name in this.fragments) {
      this.err(n.span, `fragment '${n.name}' is defined twice`)
      return
    }
    const saved = {
      scopes: this.scopes.splice(0),
      slots: this.slots,
      loops: this.loops.splice(0),
      validates: this.validates,
      reported: this.diagnostics.length,
    }
    const outer = new Set(saved.scopes.flatMap((scope) => [...scope.keys()]))
    const unit = { outer, inLoop: saved.loops.length > 0, needs: [], errors: [] }
    this.unit = unit
    this.scopes.push(new Map())
    this.slots = 0
    this.validates = false
    let body: CNode[]
    try {
      body = this.nodes(n.body, parent)
    } finally {
      this.unit = undefined
      this.scopes.splice(0, this.scopes.length, ...saved.scopes)
      this.loops.splice(0, this.loops.length, ...saved.loops)
    }
    const compiled: CheckedFragment = { needs: unit.needs, slots: this.slots, body: optimize(body) }
    if (this.validates) compiled.validates = true
    this.fragments[n.name] = compiled
    this.slots = saved.slots
    this.validates = saved.validates
    // The inline pass already reported the body's problems; keep only the
    // unit's own.
    this.diagnostics.length = saved.reported
    this.diagnostics.push(...unit.errors)
  }

  /**
   * A `@snippet`, compiled once in its own slot space: the template's inputs
   * at their own indexes, then the parameters. It sees those and page data —
   * nothing from where it's rendered, so it behaves the same everywhere.
   */
  snippet(n: Extract<Node, { k: 'snippet' }>, inputs: CheckedTemplate['inputs']): void {
    const saved = {
      scopes: this.scopes.splice(0),
      loops: this.loops.splice(0),
      slots: this.slots,
      validates: this.validates,
    }
    this.scopes.push(new Map())
    this.slots = 0
    this.validates = false
    this.inSnippet = true
    let body: CNode[]
    const params: number[] = []
    try {
      for (const i of inputs) this.bind(i.n, { kind: 'slot', s: this.slot() })
      for (const p of n.params) {
        const s = this.slot()
        params.push(s)
        this.bind(p.name, { kind: 'slot', s })
      }
      body = this.nodes(n.body)
    } finally {
      this.inSnippet = false
      this.scopes.splice(0, this.scopes.length, ...saved.scopes)
      this.loops.splice(0, this.loops.length, ...saved.loops)
    }
    const compiled: CSnippet = {
      params,
      defaults: n.params.map((p) => p.default),
      slots: this.slots,
      body: optimize(body),
    }
    if (this.validates) compiled.validates = true
    this.snippets[n.name] = compiled
    this.slots = saved.slots
    this.validates = saved.validates
  }

  /** `{{ }}` inside `<script>` / `<style>`: only a JSON script's single value. */
  private rawText(n: Extract<Node, { k: 'interp' }>, parent?: Element): CNode[] {
    const tag = parent?.tag.toLowerCase()
    const type = parent?.attrs.find((a) => a.name.toLowerCase() === 'type')
    const typeValue =
      type?.kind === 'static'
        ? String(type.parts?.[0] ?? '')
            .trim()
            .toLowerCase()
        : ''
    const isJson = tag === 'script' && JSON_SCRIPT_TYPES.has(typeValue)
    const only = parent?.children.filter((c) => !(c.k === 'text' && !c.value.trim())).length === 1
    if (isJson && only && n.expr.kind === 'pipe' && n.expr.name === 'json') {
      return [{ k: 'i', c: 'json', e: this.expr(n.expr, 'json'), at: at(n.span) }]
    }
    // Trusted CSS (inlined for PDFs and emails): the whole content of an HTML
    // <style>, through raw. In SVG a browser reads style content as markup.
    if (
      tag === 'style' &&
      !parent!.foreign &&
      only &&
      n.expr.kind === 'pipe' &&
      n.expr.name === 'raw'
    ) {
      return [{ k: 'i', c: 'css', e: this.expr(n.expr, 'css', true), at: at(n.span) }]
    }
    this.err(
      n.span,
      tag === 'script'
        ? '{{ }} isn\'t allowed inside <script>: pass data as <script type="application/json">{{ value | json }}</script>'
        : tag === 'style' && !parent!.foreign
          ? "{{ }} isn't allowed inside <style>, except trusted CSS as its whole content: <style>{{ css | raw }}</style>"
          : `{{ }} isn't allowed inside <${tag}>`,
    )
    return []
  }

  // ── elements and attributes ───────────────────────────────────────────

  /** Write an element's opening tag; returns it when its children and closing tag follow. */
  private element(el: Element, out: CNode[]): Element | undefined {
    const lower = el.tag.toLowerCase()
    if (isClientScript(el)) {
      this.err(el.span, '<script client> must be at the top level of the component')
      return undefined
    }
    if (!el.foreign && lower === 'component') {
      this.dynamic(el, out)
      return undefined
    }
    if (!el.foreign && lower.includes('-')) {
      const names = this.tags.get(lower)
      if (names && names.length > 1) {
        this.err(el.span, `<${lower}> matches more than one component: ${names.join(', ')}`)
        return undefined
      }
      if (names) {
        this.call(el, names[0]!, out, el === this.rootElement)
        return undefined
      }
      // A component with a client script renders the custom elements it defines.
      if (!this.hasClientScript)
        this.warn(
          el.span,
          `<${lower}> isn't a component (no ${this.project.componentsDir}/…/${lower}.kick) — it's output as a custom element`,
        )
    }
    const attrs = this.attrs(el)
    const refill = this.refill(el, attrs)
    const dynamic = attrs.some((a) => a.t !== 's')
    if (dynamic || el === this.rootElement) {
      out.push({ k: 's', t: `<${el.tag}` })
      const node: Extract<CNode, { k: 'A' }> = { k: 'A', tag: el.tag, a: attrs, at: at(el.span) }
      if (el === this.rootElement) node.f = 1
      out.push(node)
    } else {
      out.push({
        k: 's',
        t: `<${el.tag}${attrs.map((a) => staticAttr(a as Extract<CAttr, { t: 's' }>)).join('')}`,
      })
    }
    if (el.void || (el.selfClosing && el.foreign)) {
      out.push({ k: 's', t: el.selfClosing ? ' />' : '>' })
      return undefined
    }
    out.push({ k: 's', t: '>' })
    // An empty <textarea name> refills from `$old`.
    // The leading newline is the parser's to drop, so a value starting with
    // one keeps it.
    if (refill && lower === 'textarea' && el.children.length === 0)
      out.push({ k: 's', t: '\n' }, { k: 'i', c: 'rcdata', e: oldOf(refill), at: at(el.span) })
    return el
  }

  /** The template has a `validate` field: pages rendering it ship the validator script. */
  validates = false

  private validateAttr(el: Element, a: Element['attrs'][number], out: CAttr[]): void {
    if (a.kind !== 'static') {
      this.err(a.span, 'validate must be written, not bound')
      return
    }
    if (!el.attrs.some((x) => x.name.toLowerCase() === 'name')) {
      this.err(a.span, 'validate needs a name on the same field')
      return
    }
    const r = parseValidate(decodeEntities(String(a.parts?.[0] ?? '')), this.project.validators)
    if ('error' in r) {
      this.err(a.span, r.error)
      return
    }
    this.validates = true
    // Written as is into the attribute: `&` escaped here, `"` by the writer.
    out.push({ t: 's', n: 'data-kick-validate', v: JSON.stringify(r.rules).replace(/&/g, '&amp;') })
  }

  /** The `<select name>` being walked, for its options' refill. */
  private select?: string

  /**
   * Refill from `$old` — what a failed submit sent — for a named form control
   * the template doesn't set itself: `value`, `checked`, `selected`, or an
   * empty `<textarea>`'s text. Never for secrets, files or hidden fields.
   * Returns the field name when the control refills.
   */
  private refill(el: Element, attrs: CAttr[]): string | undefined {
    if (el.foreign) return undefined
    const tag = el.tag.toLowerCase()
    const has = (n: string) => el.attrs.some((a) => a.name.toLowerCase() === n)
    const stat = (n: string) => {
      const a = el.attrs.find((x) => x.name.toLowerCase() === n && x.kind === 'static')
      return a ? String(a.parts?.[0] ?? '') : undefined
    }
    /** `value="x"` or `value="{{ x }}"`, as an expression to compare `$old` with. */
    const valueExpr = (): CExpr | undefined => {
      const a = el.attrs.find((x) => x.name.toLowerCase() === 'value')
      // What the browser submits: character references decoded.
      if (a?.kind === 'static') return { k: 'l', v: decodeEntities(String(a.parts?.[0] ?? '')) }
      // `'' + x`: the attribute prints as text, and `$old` holds the text a browser sent.
      if (a?.kind === 'interp' && a.parts?.length === 1 && typeof a.parts[0] !== 'string')
        return { k: 'b', o: '+', l: { k: 'l', v: '' }, r: this.expr(a.parts[0]!, 'attr') }
      return undefined
    }
    if (tag === 'option') {
      const value = valueExpr()
      if (this.select === undefined || value === undefined || has('selected')) return undefined
      attrs.push({ t: 'b', n: 'selected', e: equals(oldOf(this.select), value) })
      return undefined
    }
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return undefined
    const name = stat('name')
    if (!name || SECRET_FIELD.test(name)) return undefined
    if (tag === 'select') {
      this.select = name
      return name
    }
    if (tag === 'textarea') return name
    // A bound type could be `password`: never refill what can't be read here.
    if (has('type') && stat('type') === undefined) return undefined
    const type = (stat('type') ?? 'text').toLowerCase()
    if (NO_REFILL.has(type)) return undefined
    if (type === 'checkbox' || type === 'radio') {
      if (has('checked')) return undefined
      const value = has('value') ? valueExpr() : { k: 'l' as const, v: 'on' }
      if (!value) return undefined
      attrs.push({ t: 'b', n: 'checked', e: equals(oldOf(name), value) })
      return name
    }
    if (has('value')) return undefined
    attrs.push({ t: 'b', n: 'value', e: oldOf(name) })
    return name
  }

  /** The single root element of a component, which takes fallthrough attributes. */
  rootElement?: Element

  /** The component has a `<script client>`: its custom elements are expected. */
  hasClientScript = false

  private attrs(el: Element): CAttr[] {
    const tag = el.tag
    const out: CAttr[] = []
    const httpEquiv = el.attrs.find((a) => a.name.toLowerCase() === 'http-equiv')
    const refresh =
      tag.toLowerCase() === 'meta' &&
      httpEquiv?.kind === 'static' &&
      String(httpEquiv.parts?.[0]).trim().toLowerCase() === 'refresh'
    for (const a of el.attrs) {
      const lower = a.name.toLowerCase()
      // `validate="required | minLength:3"`: rule data for the validator script.
      if (lower === 'validate' && !el.foreign) {
        this.validateAttr(el, a, out)
        continue
      }
      const dynamic = a.kind !== 'static' && a.kind !== 'bare'
      if (dynamic && a.kind !== 'class' && a.kind !== 'style') {
        if (lower.startsWith('on')) {
          this.err(
            a.span,
            `${a.name} can't be interpolated: event handler attributes run their value as script`,
          )
          continue
        }
        if (lower === 'srcdoc') {
          this.err(a.span, "srcdoc can't be interpolated: its value is a whole HTML document")
          continue
        }
        if (lower === 'style') {
          this.err(
            a.span,
            'style can\'t be interpolated — bind one property with [style.prop]="value"',
          )
          continue
        }
        if (lower === 'class' && a.kind === 'interp') {
          this.err(
            a.span,
            'class can\'t be interpolated — add classes with [class.name]="condition"',
          )
          continue
        }
        if (ANIMATION.has(tag.toLowerCase()) && ANIMATION_VALUES.has(lower)) {
          this.err(
            a.span,
            `${a.name} can't be interpolated on <${tag}>: an animation can set href to a javascript: URL`,
          )
          continue
        }
        if (refresh && lower === 'content') {
          this.err(
            a.span,
            "a refresh <meta>'s content can't be interpolated: it holds a URL to navigate to",
          )
          continue
        }
      }
      const url = isUrlAttr(tag, a.name) ? (lower === 'srcset' ? 'srcset' : 'url') : undefined
      // A binding whose expression didn't parse: the parser already reported it.
      if ((a.kind === 'bind' || a.kind === 'class' || a.kind === 'style') && !a.expr) continue
      switch (a.kind) {
        case 'bare':
          out.push({ t: 's', n: a.name, v: true })
          break
        case 'static':
          out.push({ t: 's', n: a.name, v: String(a.parts?.[0] ?? '') })
          break
        case 'interp': {
          const node: CAttr = {
            t: 'i',
            n: a.name,
            p: a.parts!.map((p) => (typeof p === 'string' ? p : this.expr(p, 'attr'))),
          }
          if (url) node.u = url
          out.push(node)
          break
        }
        case 'bind': {
          const node: CAttr = { t: 'b', n: a.name, e: this.expr(a.expr!, 'attr') }
          if (url) node.u = url
          out.push(node)
          break
        }
        case 'class':
          out.push({ t: 'c', n: a.name, e: this.expr(a.expr!, 'attr') })
          break
        case 'style': {
          const node: CAttr = { t: 'y', n: a.name, e: this.expr(a.expr!, 'attr') }
          if (a.unit) node.x = a.unit
          out.push(node)
          break
        }
      }
    }
    return out
  }

  // ── components ────────────────────────────────────────────────────────

  signature(name: string): Signature {
    const cached = this.signatures.get(name)
    if (cached) return cached
    const ast = this.project.templates.get(name)!
    const outlets = new Map<string, string[]>()
    const stack: Node[][] = [ast.body]
    while (stack.length) {
      for (const n of stack.pop()!) {
        if (n.k === 'slot-outlet') {
          if (!outlets.has(n.name ?? ''))
            outlets.set(
              n.name ?? '',
              n.offers.map((o) => o.name),
            )
          stack.push(n.fallback)
        } else if (n.k === 'element' || n.k === 'comment') stack.push(n.children)
        else if (n.k === 'if') for (const b of n.branches) stack.push(b.body)
        else if (n.k === 'for') stack.push(n.body, n.empty ?? [])
        else if (n.k === 'switch') stack.push(...n.cases.map((c) => c.body), n.default ?? [])
        else if (n.k === 'slot-fill' || n.k === 'fragment' || n.k === 'push' || n.k === 'snippet')
          stack.push(n.body)
      }
    }
    // A lifted `<script client>` isn't markup, so not a root either.
    const top = ast.body.filter((n) => !(n.k === 'element' && isClientScript(n)))
    const roots = rootElements(top)
    let root: Signature['root']
    if (roots.length === 1) {
      const el = roots[0]
      const tag = el?.tag.toLowerCase()
      if (el && !el.foreign && tag!.includes('-') && this.tags.get(tag!)?.length === 1) {
        root = { k: 'cmp', name: this.tags.get(tag!)![0]! }
      } else if (el) {
        root = { k: 'el', tag: tag! }
        if (tag === 'component' && !el.foreign) {
          const of = el.attrs.find((a) => a.name.toLowerCase() === 'of' && a.kind === 'static')
          root.of = String(of?.parts?.[0] ?? '')
            .split(/\s+/)
            .filter(Boolean)
        }
      } else if (top.some((n) => n.k === 'slot-outlet')) root = { k: 'slot' }
    }
    const sig: Signature = {
      name,
      inputs: new Map(
        ast.inputs.map((i) => [i.name, { required: !i.default, def: i.default?.value }]),
      ),
      outlets,
      roots: roots.length,
      ...(root ? { root } : {}),
    }
    this.signatures.set(name, sig)
    return sig
  }

  /** The value an attribute passes to an input, or undefined (reported) when it can't be one. */
  private inputExpr(a: Attr, def: unknown): CExpr | undefined {
    if (a.kind === 'bind') return this.expr(a.expr!)
    if (a.kind === 'bare') return { k: 'l', v: true }
    if (a.kind === 'static') {
      const v = String(a.parts?.[0] ?? '')
      if (typeof def === 'boolean' && (v === 'true' || v === 'false')) {
        this.warn(
          a.span,
          `${a.name}="${v}" passes the string "${v}", which is truthy — write [${a.name}]="${v}"`,
        )
      }
      // Text passed to an input is data: entities decoded here, the value
      // escaped wherever it's printed.
      return { k: 'l', v: decodeEntities(v) }
    }
    if (a.kind === 'interp') {
      return a.parts!.reduce<CExpr>(
        (acc, p) => ({
          k: 'b',
          o: '+',
          l: acc,
          r: typeof p === 'string' ? { k: 'l', v: decodeEntities(p) } : this.expr(p),
        }),
        { k: 'l', v: '' },
      )
    }
    this.err(a.span, `[${a.kind}.${a.name}] goes on the component's root element, not an input`)
    return undefined
  }

  private call(
    el: Element,
    name: string,
    out: CNode[],
    root = false,
    /** One candidate of a `<component>`: slot fills are checked across all candidates instead. */
    candidate = false,
  ): void {
    const sig = this.signature(name)
    const target = this.project.templates.get(name)!
    const slotOf = new Map<string, number>()
    target.inputs.forEach((i, idx) => slotOf.set(i.name, idx))
    const inputs: Array<{ s: number; e: CExpr }> = []
    const given = new Set<string>()
    const fallthrough: Attr[] = []
    for (const a of el.attrs) {
      if (isFallthrough(a)) {
        fallthrough.push(a)
        continue
      }
      const input = sig.inputs.has(a.name) ? a.name : camel(a.name)
      if (!sig.inputs.has(input)) {
        // Not an input: the root element's attribute.
        const near = nearInput(a.name, sig.inputs.keys())
        if (near) {
          this.warn(
            a.span,
            `'${a.name}' isn't an input of ${el.tag} — did you mean '${near}'? It's passed to the root element.`,
          )
        }
        fallthrough.push(a)
        continue
      }
      if (a.kind === 'bind' && !a.expr) continue
      given.add(input)
      const e = this.inputExpr(a, sig.inputs.get(input)!.def)
      if (!e) continue
      inputs.push({ s: slotOf.get(input)!, e })
    }
    for (const [input, info] of sig.inputs) {
      if (info.required && !given.has(input))
        this.err(el.span, `missing input '${input}' on <${el.tag}>`)
    }
    // Down a chain of wrapper components (a root that is itself a component):
    // an attribute one of them declares is that one's input; the rest go on
    // to the element at the end.
    const chained: Array<{ n: string; e: CExpr }> = []
    let leaf = sig
    const seen = new Set([name])
    while (
      leaf.root?.k === 'cmp' &&
      fallthrough.length &&
      leaf.roots === 1 &&
      !seen.has(leaf.root.name)
    ) {
      seen.add(leaf.root.name)
      const inner = this.signature(leaf.root.name)
      const rest: Attr[] = []
      for (const a of fallthrough) {
        const input = inner.inputs.has(a.name) ? a.name : camel(a.name)
        if (isFallthrough(a) || !inner.inputs.has(input)) {
          rest.push(a)
          continue
        }
        const e = this.inputExpr(a, inner.inputs.get(input)!.def)
        if (e) chained.push({ n: input, e })
      }
      fallthrough.splice(0, fallthrough.length, ...rest)
      leaf = inner
    }
    const passed = fallthrough.map((a) => a.name).join(', ')
    // `class`, `id`, `aria-*`… touch no tag-keyed check: they may reach a
    // <component> root, whose element is only picked at render time.
    const tagDependent = fallthrough.filter((a) => !isFallthrough(a))
    if (fallthrough.length && (leaf.roots !== 1 || !leaf.root)) {
      this.err(
        fallthrough[0]!.span,
        `<${el.tag}> passes ${passed} to its root element, but ${leaf.name}.kick needs exactly one root element for that`,
      )
    } else if (tagDependent.length && leaf.root?.k === 'el' && leaf.root.tag === 'component') {
      this.err(
        tagDependent[0]!.span,
        `<${el.tag}> passes ${tagDependent.map((a) => a.name).join(', ')} to its root, but ${leaf.name}.kick's root is a <component>, whose element is only chosen at render time — declare them as inputs and pass them on`,
      )
    } else if (fallthrough.length && leaf.root?.k === 'el' && leaf.root.of) {
      // class/id/… go to whichever candidate renders: each needs an element root.
      const without = leaf.root.of.filter((tag) => {
        const names = this.tags.get(tag.toLowerCase())
        if (names?.length !== 1) return false
        const cand = this.signature(names[0]!)
        return cand.roots !== 1 || !cand.root || cand.root.k === 'slot'
      })
      if (without.length) {
        this.err(
          fallthrough[0]!.span,
          `<${el.tag}> passes ${passed} on to its <component>'s candidates, but ${without.join(', ')} has no single root element to take them`,
        )
      }
    } else if (fallthrough.length && leaf.root?.k === 'slot') {
      this.err(
        fallthrough[0]!.span,
        `<${el.tag}> passes ${passed} to its root, but ${leaf.name}.kick's root is a <slot>, which takes no attributes`,
      )
    } else if (leaf.root?.k === 'el' && Object.hasOwn(GUARDED, leaf.root.tag)) {
      const names = GUARDED[leaf.root.tag]!
      // `[class.type]` adds a class; only real attributes of that name count.
      const guarded = fallthrough.filter(
        (a) => a.kind !== 'class' && a.kind !== 'style' && names.has(a.name.toLowerCase()),
      )
      for (const a of guarded) {
        this.err(
          a.span,
          `'${a.name}' would reach the <${leaf.root.tag}> in ${leaf.name}.kick, whose safety checks depend on its other attributes — declare it as an @input of ${el.tag}`,
        )
      }
      // Reported once, not compiled too.
      fallthrough.splice(0, fallthrough.length, ...fallthrough.filter((a) => !guarded.includes(a)))
    }
    // Slot content: `@slot('x') { }` fills, the rest is the default slot. It
    // is compiled here, in the caller's scope.
    const fills: Record<string, CFill> = {}
    const rest: Node[] = []
    for (const c of el.children) {
      if (c.k !== 'slot-fill') {
        rest.push(c)
        continue
      }
      if (c.name in fills) this.err(c.span, `slot '${c.name}' is filled twice`)
      else if (!sig.outlets.has(c.name) && !candidate) {
        this.err(c.span, `<${el.tag}> has no slot '${c.name}'`)
      }
      fills[c.name] = this.fill(c, candidate ? undefined : sig.outlets.get(c.name))
    }
    if (rest.some((c) => !(c.k === 'text' && !c.value.trim()))) {
      if (!sig.outlets.has('')) {
        if (!candidate) {
          this.err(el.span, `<${el.tag}> has no default <slot /> for the content inside it`)
        }
      } else if ('' in fills) {
        this.err(
          el.span,
          `<${el.tag}>'s default slot is filled twice: by the content between its tags and by @slot(default …)`,
        )
      } else {
        fills[''] = { nodes: this.scoped(() => this.nodes(rest)) }
      }
    }
    // Checked as written on the element they land on (URL attributes, …).
    const rootTag = leaf.root?.k === 'el' ? leaf.root.tag : el.tag
    const fa = this.attrs({ ...el, tag: rootTag, attrs: fallthrough })
    out.push({
      k: 'cmp',
      n: name,
      in: inputs,
      ...(chained.length ? { ci: chained } : {}),
      fa,
      f: fills,
      ...(root ? { r: 1 as const } : {}),
      at: at(el.span),
    })
  }

  /**
   * `<component [is]="expr" of="tag-a tag-b">`: an ordinary call per
   * candidate (inputs, passthrough and fills checked for each), picked at
   * render time. Fills and their `let`s are checked across the candidates.
   */
  private dynamic(el: Element, out: CNode[]): void {
    const plain = (a: Attr) => a.kind !== 'class' && a.kind !== 'style'
    const isA = el.attrs.find((a) => plain(a) && a.name.toLowerCase() === 'is')
    const ofA = el.attrs.find((a) => plain(a) && a.name.toLowerCase() === 'of')
    if (!ofA || ofA.kind !== 'static') {
      this.err(
        ofA?.span ?? el.span,
        '<component> needs of="tag-a tag-b": the components it may render',
      )
      return
    }
    if (!isA || isA.kind !== 'bind' || !isA.expr) {
      this.err(
        isA?.span ?? el.span,
        '<component> needs [is]="expr" — a bound value; for a fixed component, write its tag',
      )
      return
    }
    const rest = el.attrs.filter((a) => a !== isA && a !== ofA)
    if (!String(ofA.parts?.[0] ?? '').trim()) {
      this.err(ofA.span, '<component> needs at least one tag in of="…"')
      return
    }
    const c: Record<string, CNode> = Object.create(null)
    const sigs: Signature[] = []
    const reported = this.diagnostics.length
    for (const tag of String(ofA.parts?.[0] ?? '')
      .split(/\s+/)
      .filter(Boolean)) {
      const lower = tag.toLowerCase()
      if (lower in c) {
        this.warn(ofA.span, `${lower} is listed twice in of`)
        continue
      }
      const names = this.tags.get(lower)
      if (!names || names.length !== 1) {
        this.err(
          ofA.span,
          `<component> lists ${lower}, which isn't a component (no ${this.project.componentsDir}/…/${lower}.kick)`,
        )
        continue
      }
      const one: CNode[] = []
      // No slot content here: it's compiled once below, for every candidate.
      this.call(
        { ...el, tag: lower, attrs: rest, children: [] },
        names[0]!,
        one,
        el === this.rootElement,
        true,
      )
      const cmp = one.find((n) => n.k === 'cmp')
      if (cmp) c[lower] = cmp
      sigs.push(this.signature(names[0]!))
    }
    // The fills compile once per candidate: report each problem once.
    const seen = new Set<string>()
    const mine = this.diagnostics.splice(reported).filter((d) => {
      const key = `${d.severity}|${d.span.start.offset}|${d.message}`
      return !seen.has(key) && seen.add(key)
    })
    this.diagnostics.push(...mine)
    // Slot content, compiled once in the caller's scope; its slots and `let`s
    // are checked across the candidates below.
    const fills: Record<string, CFill> = {}
    const loose: Node[] = []
    for (const ch of el.children) {
      if (ch.k !== 'slot-fill') {
        loose.push(ch)
        continue
      }
      if (ch.name in fills) this.err(ch.span, `slot '${ch.name || 'default'}' is filled twice`)
      else fills[ch.name] = this.fill(ch, undefined)
    }
    if (loose.some((ch) => !(ch.k === 'text' && !ch.value.trim()))) {
      if (sigs.length && !sigs.some((s) => s.outlets.has(''))) {
        this.err(
          el.span,
          'no candidate of <component> has a default <slot /> for the content inside it',
        )
      } else if ('' in fills) {
        this.err(
          el.span,
          "<component>'s default slot is filled twice: by the content between its tags and by @slot(default …)",
        )
      } else {
        fills[''] = { nodes: this.scoped(() => this.nodes(loose)) }
      }
    }
    for (const f of el.children) {
      if (f.k !== 'slot-fill') continue
      const having = sigs.filter((s) => s.outlets.has(f.name))
      if (!having.length) {
        this.err(f.span, `no candidate of <component> has a slot '${f.name || 'default'}'`)
        continue
      }
      for (const l of f.lets) {
        if (!having.some((s) => s.outlets.get(f.name)!.includes(l.from))) {
          this.err(f.span, `no candidate's slot '${f.name || 'default'}' offers '${l.from}'`)
        }
      }
    }
    out.push({ k: 'dyn', e: this.expr(isA.expr), c, f: fills, at: at(el.span) })
  }

  /**
   * Slot content, compiled in the caller's scope with its `let`s bound. With
   * `offered` known, a `let` taking a name the slot doesn't offer is an error.
   */
  fill(f: Extract<Node, { k: 'slot-fill' }>, offered: readonly string[] | undefined): CFill {
    return this.scoped(() => {
      const params: Array<{ from: string; s: number }> = []
      for (const l of f.lets) {
        if (offered && !offered.includes(l.from)) {
          this.err(
            f.span,
            `slot '${f.name || 'default'}' doesn't offer '${l.from}' — it offers ${offered.join(', ') || 'nothing'}`,
          )
        }
        const s = this.slot()
        params.push({ from: l.from, s })
        this.bind(l.name, { kind: 'slot', s })
      }
      const nodes = this.nodes(f.body)
      return params.length ? { nodes, params } : { nodes }
    })
  }

  // ── layouts ───────────────────────────────────────────────────────────

  /** What `ref`, written in template `from`, names (its view root first). */
  ref(from: string, ref: string): string {
    return resolveRef(from, ref, (n) => this.project.templates.has(n))
  }

  /** The outlets a page can fill: its layout chain's. Reports bad names and cycles. */
  layoutChain(
    start: string | undefined,
    span: Span,
    page: string,
  ): Map<string, string[]> | undefined {
    const outlets = new Map<string, string[]>()
    const seen = [page]
    let name = start
    while (name) {
      if (!templateName(name)) {
        this.err(span, `'${name}' isn't a valid template name`)
        return undefined
      }
      if (seen.includes(name)) {
        this.err(span, `layout cycle: ${[...seen, name].join(' → ')}`)
        return undefined
      }
      const ast = this.project.templates.get(name)
      if (!ast) {
        this.err(span, `layout '${name}' not found`)
        return undefined
      }
      seen.push(name)
      mergeOutlets(outlets, this.signature(name).outlets)
      name = ast.layout ? this.ref(name, ast.layout) : undefined
    }
    return outlets
  }
}

/** Top-level elements, or -1 per other non-whitespace output (text, blocks). */
function isClientScript(n: Node): boolean {
  return (
    n.k === 'element' &&
    n.tag.toLowerCase() === 'script' &&
    n.attrs.some((a) => a.name.toLowerCase() === 'client' && a.kind === 'bare')
  )
}

function rootElements(body: Node[]): Array<Element | null> {
  const roots: Array<Element | null> = []
  for (const n of body) {
    if (n.k === 'text' && !n.value.trim()) continue
    if (n.k === 'comment' || n.k === 'let' || n.k === 'push' || n.k === 'snippet') continue
    roots.push(n.k === 'element' ? n : null)
  }
  return roots
}

/**
 * Slot names from `more` added to `into`. A name both have keeps only the
 * values both offer: a page's fill renders in each, so a `let` must be
 * offered by every outlet it reaches.
 */
function mergeOutlets(
  into: Map<string, string[]>,
  more: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
  for (const [name, offers] of more) {
    const had = into.get(name)
    into.set(name, had ? had.filter((o) => offers.includes(o)) : [...offers])
  }
  return into
}

/** An attribute as the author wrote it (entities kept), double-quoted. */
function staticAttr(a: Extract<CAttr, { t: 's' }>): string {
  return a.v === true ? ` ${a.n}` : ` ${a.n}="${a.v.replace(/"/g, '&quot;')}"`
}

const at = (span: Span): [number, number] => [span.start.line, span.start.column]

const zero: Span = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
}

/** Check one template of `project` by name. */
export function check(name: string, project: Project): CheckResult {
  const ast = project.templates.get(name)
  if (!ast || !templateName(name)) {
    return { diagnostics: [error(`${name}.kick`, zero, `template '${name}' not found`)] }
  }
  const component = isComponent(name, project.componentsDir)
  const c = new Checker(project, ast, component)

  // A page's @inputs declare its render data (typed for typegen); its reads
  // stay data reads, so its layouts see the same values. A component's are
  // its inputs, bound to slots.
  const pageDefaults: Record<string, Literal> = {}
  if (!component) {
    for (const i of ast.inputs) if (i.default) pageDefaults[i.name] = i.default.value
  }
  const inputs = (component ? ast.inputs : []).map((i, idx) => {
    const s = idx
    const entry: CheckedTemplate['inputs'][number] = { n: i.name, s, r: !i.default }
    if (i.default) entry.d = i.default.value
    return entry
  })
  // Input slots come first, in declaration order.
  c.slots = inputs.length
  for (const i of inputs) c.bind(i.n, { kind: 'slot', s: i.s })

  // Snippets: every name and parameter list first (a body may render any of
  // them, defined before or after), then each body.
  const snippetNodes: Array<Extract<Node, { k: 'snippet' }>> = []
  for (const n of ast.body) {
    if (n.k === 'let') c.topLets.add(n.name)
    if (n.k !== 'snippet') continue
    if (c.snippetDefs.has(n.name)) {
      c.diagnostics.push(error(ast.file, n.span, `snippet '${n.name}' is defined twice`))
      continue
    }
    c.snippetDefs.set(n.name, n.params)
    snippetNodes.push(n)
  }

  // `<script client>`: the component's browser code, shipped as a module of
  // its own — lifted out of the template before anything else looks at it.
  const top: Node[] = []
  let client: CheckedTemplate['client']
  for (const n of ast.body) {
    if (
      n.k === 'element' &&
      n.tag.toLowerCase() === 'script' &&
      n.attrs.some((a) => a.name.toLowerCase() === 'client' && a.kind !== 'bare')
    ) {
      // `client="…"` isn't lifted: say so rather than ship TypeScript inline.
      c.diagnostics.push(error(ast.file, n.span, 'write <script client> with no value'))
      continue
    }
    if (n.k !== 'element' || !isClientScript(n)) {
      top.push(n)
      continue
    }
    if (!component) {
      c.diagnostics.push(
        error(
          ast.file,
          n.span,
          `<script client> is only for components (src/views/${project.componentsDir}/…)`,
        ),
      )
      continue
    }
    if (client) {
      c.diagnostics.push(error(ast.file, n.span, 'a component has one <script client>'))
      continue
    }
    if (n.children.some((ch) => ch.k !== 'text')) {
      c.diagnostics.push(
        error(ast.file, n.span, "<script client> can't use {{ }} — pass data through attributes"),
      )
      continue
    }
    const code = n.children.map((ch) => (ch.k === 'text' ? ch.value : '')).join('')
    // Served as `<tag>.<hash>.js`: the tag has to be a plain file name.
    const tag = componentTag(name, project.componentsDir)
    if (tag === 'kick-validate') {
      c.diagnostics.push(
        error(ast.file, n.span, 'kick-validate is reserved for the validator script'),
      )
      continue
    }
    if (tag === VALIDATORS_TAG) {
      c.diagnostics.push(
        error(ast.file, n.span, "kick-validators is reserved for the app's validators"),
      )
      continue
    }
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) {
      c.diagnostics.push(
        error(
          ast.file,
          n.span,
          `<script client> needs a component name of lowercase letters, digits and dashes: '${tag}'`,
        ),
      )
      continue
    }
    client = { code, js: false }
  }

  c.hasClientScript = client !== undefined
  // After hasClientScript: a snippet may use the client script's custom elements.
  for (const n of snippetNodes) c.snippet(n, inputs)
  if (component) {
    const roots = rootElements(top)
    if (roots.length === 1 && roots[0]) c.rootElement = roots[0]
  }

  // A page's top-level `@slot` blocks fill its layout's outlets.
  const fills: Record<string, CFill> = {}
  const body: Node[] = []
  const fillNodes: Array<Extract<Node, { k: 'slot-fill' }>> = []
  for (const [i, n] of top.entries()) {
    if (n.k === 'snippet') {
      // A definition prints nothing: its line goes too — the newline after
      // it, or before it at the end of the file.
      const next = top[i + 1]
      const prev = body.at(-1)
      if (next?.k === 'text' && /^\r?\n/.test(next.value)) {
        top[i + 1] = { ...next, value: next.value.replace(/^\r?\n/, '') }
      } else if (!next && prev?.k === 'text') {
        body[body.length - 1] = { ...prev, value: prev.value.replace(/\r?\n$/, '') }
      }
      continue
    }
    if (n.k === 'slot-fill' && !component) fillNodes.push(n)
    else body.push(n)
  }

  const base = project.baseLayout
  if (base !== undefined && !project.templates.has(base)) {
    c.diagnostics.push(error(ast.file, zero, `base layout '${base}' not found`))
  }
  // A page's own @layout wins; otherwise the configured mapping applies —
  // to pages, not to components or to templates configured as layouts.
  const mapped =
    component || configuredLayouts(project).has(name)
      ? undefined
      : layoutResolver(project.layouts)(name)
  // A root's template means its own root's layout first (`resolveRef`).
  const declared = ast.layout ? c.ref(name, ast.layout) : ast.layout
  const layoutName = declared === undefined ? mapped : (declared ?? undefined)
  let outlets =
    layoutName === undefined ? undefined : c.layoutChain(layoutName, ast.layoutSpan ?? zero, name)
  // The base layout wraps the chain, so its outlets are fillable too.
  if (
    base !== undefined &&
    ast.layout !== null &&
    !component &&
    name !== base &&
    project.templates.has(base)
  ) {
    outlets = mergeOutlets(outlets ?? new Map(), c.signature(base).outlets)
  }

  const bodyContent = body.some(
    (n) => n.k !== 'let' && n.k !== 'comment' && !(n.k === 'text' && !n.value.trim()),
  )
  for (const f of fillNodes) {
    if (f.name === '' && bodyContent) {
      c.diagnostics.push(
        error(
          ast.file,
          f.span,
          "the layout's default slot is filled twice: by the page's own content and by @slot(default …)",
        ),
      )
      continue
    }
    if (f.name in fills) {
      c.diagnostics.push(error(ast.file, f.span, `slot '${f.name}' is filled twice`))
      continue
    }
    if (!outlets) {
      // No layout is known here — a build that doesn't have the app's
      // mapping, say. Kept, and filled if the page gets a layout with it.
      c.diagnostics.push(warning(ast.file, f.span, `@slot('${f.name}') has no layout to fill here`))
      const fill = c.fill(f, undefined)
      fills[f.name] = { ...fill, nodes: optimize(fill.nodes) }
      continue
    }
    if (!outlets.has(f.name)) {
      c.diagnostics.push(error(ast.file, f.span, `the layout has no slot '${f.name}'`))
      continue
    }
    // The default fill goes to the page's own layout (outer layouts' default
    // slots get the layout inside them), so that one must have a default slot.
    const first =
      layoutName ??
      (base !== undefined && ast.layout !== null && !component && name !== base ? base : undefined)
    if (
      f.name === '' &&
      first &&
      project.templates.has(first) &&
      !c.signature(first).outlets.has('')
    ) {
      c.diagnostics.push(
        error(ast.file, f.span, `layout '${first}' has no default <slot /> for @slot(default …)`),
      )
      continue
    }
    const fill = c.fill(f, outlets.get(f.name))
    fills[f.name] = { ...fill, nodes: optimize(fill.nodes) }
  }

  const template: CheckedTemplate = {
    v: AST_FORMAT_VERSION,
    name,
    file: ast.file,
    slots: 0,
    inputs,
    fills,
    body: optimize(c.nodes(body)),
  }
  template.slots = c.slots
  if (declared !== undefined) template.layout = declared
  if (client) template.client = client
  if (c.validates) template.validates = true
  if (Object.keys(pageDefaults).length) template.defaults = pageDefaults
  if (Object.keys(c.fragments).length) template.fragments = c.fragments
  if (Object.keys(c.snippets).length) template.snippets = c.snippets
  const failed = c.diagnostics.some((d) => d.severity === 'error')
  return failed ? { diagnostics: c.diagnostics } : { template, diagnostics: c.diagnostics }
}
