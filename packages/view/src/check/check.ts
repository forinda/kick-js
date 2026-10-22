/**
 * `check`: turn a parsed template into a checked one — names resolved,
 * pipes, components, slots and layouts verified, and every interpolation's
 * context enforced (spec §4). What passes here is safe to render.
 */
import { FORM_GLOBALS, SECRET_FIELD } from '../form-state'
import {
  AST_FORMAT_VERSION,
  type Attr,
  type CAttr,
  type CExpr,
  type CNode,
  type CSeg,
  type CheckedTemplate,
  type Element,
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
  templateName,
  type Project,
} from './project'
import { optimize } from './optimize'

export type { CheckedTemplate } from '../ast'

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
  outlets: Set<string>
  roots: number
}

class Checker {
  readonly diagnostics: Diagnostic[] = []
  slots = 0
  private readonly scopes: Array<Map<string, Binding>> = [new Map()]
  private readonly loops: number[] = []
  private readonly warned = new Set<string>()
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
   * `whole` is true only for the whole expression of a text `{{ }}` — the one
   * place `raw` may appear (as its outermost pipe). Nested anywhere else, raw
   * could smuggle markup into an attribute or another context.
   */
  expr(e: Expr, where: 'text' | 'attr' | 'rcdata' | 'json' = 'text', whole = false): CExpr {
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
        if (e.name === 'raw' && !(whole && where === 'text')) {
          this.err(
            e.span,
            where === 'attr'
              ? "raw isn't allowed in an attribute: it could break out of the quotes"
              : where === 'text'
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
      case 'slot-outlet':
        out.push({ k: 'o', n: n.name ?? '', fb: this.scoped(() => this.nodes(n.fallback, parent)) })
        return
      case 'slot-fill':
        this.err(
          n.span,
          "@slot('…') { } goes at the top of a page with a layout, or inside a component tag",
        )
        return
      case 'assets':
        out.push({ k: 'as', en: n.entry })
    }
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
    this.err(
      n.span,
      tag === 'script'
        ? '{{ }} isn\'t allowed inside <script>: pass data as <script type="application/json">{{ value | json }}</script>'
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
    if (!el.foreign && lower.includes('-')) {
      const names = this.tags.get(lower)
      if (names && names.length > 1) {
        this.err(el.span, `<${lower}> matches more than one component: ${names.join(', ')}`)
        return undefined
      }
      if (names) {
        this.call(el, names[0]!, out)
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
    const outlets = new Set<string>()
    const stack: Node[][] = [ast.body]
    while (stack.length) {
      for (const n of stack.pop()!) {
        if (n.k === 'slot-outlet') {
          outlets.add(n.name ?? '')
          stack.push(n.fallback)
        } else if (n.k === 'element' || n.k === 'comment') stack.push(n.children)
        else if (n.k === 'if') for (const b of n.branches) stack.push(b.body)
        else if (n.k === 'for') stack.push(n.body, n.empty ?? [])
        else if (n.k === 'switch') stack.push(...n.cases.map((c) => c.body), n.default ?? [])
        else if (n.k === 'slot-fill') stack.push(n.body)
      }
    }
    const sig: Signature = {
      name,
      inputs: new Map(
        ast.inputs.map((i) => [i.name, { required: !i.default, def: i.default?.value }]),
      ),
      outlets,
      roots: rootElements(ast.body).length,
    }
    this.signatures.set(name, sig)
    return sig
  }

  private call(el: Element, name: string, out: CNode[]): void {
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
        this.err(
          a.span,
          `unknown input '${a.name}' on <${el.tag}> — its inputs are ${[...sig.inputs.keys()].join(', ') || 'none'}`,
        )
        continue
      }
      if (a.kind === 'bind' && !a.expr) continue
      given.add(input)
      let e: CExpr
      if (a.kind === 'bind') e = this.expr(a.expr!)
      else if (a.kind === 'bare') e = { k: 'l', v: true }
      else if (a.kind === 'static') {
        const v = String(a.parts?.[0] ?? '')
        if (typeof sig.inputs.get(input)!.def === 'boolean' && (v === 'true' || v === 'false')) {
          this.warn(
            a.span,
            `${a.name}="${v}" passes the string "${v}", which is truthy — write [${a.name}]="${v}"`,
          )
        }
        // Text passed to an input is data: entities decoded here, the value
        // escaped wherever it's printed.
        e = { k: 'l', v: decodeEntities(v) }
      } else if (a.kind === 'interp') {
        e = a.parts!.reduce<CExpr>(
          (acc, p) => ({
            k: 'b',
            o: '+',
            l: acc,
            r: typeof p === 'string' ? { k: 'l', v: decodeEntities(p) } : this.expr(p),
          }),
          { k: 'l', v: '' },
        )
      } else {
        this.err(a.span, `[${a.kind}.${a.name}] goes on the component's root element, not an input`)
        continue
      }
      inputs.push({ s: slotOf.get(input)!, e })
    }
    for (const [input, info] of sig.inputs) {
      if (info.required && !given.has(input))
        this.err(el.span, `missing input '${input}' on <${el.tag}>`)
    }
    if (fallthrough.length && sig.roots !== 1) {
      this.err(
        fallthrough[0]!.span,
        `<${el.tag}> passes ${fallthrough.map((a) => a.name).join(', ')} to its root element, but ${name}.kick needs exactly one root element for that`,
      )
    }
    // Slot content: `@slot('x') { }` fills, the rest is the default slot. It
    // is compiled here, in the caller's scope.
    const fills: Record<string, CNode[]> = {}
    const rest: Node[] = []
    for (const c of el.children) {
      if (c.k !== 'slot-fill') {
        rest.push(c)
        continue
      }
      if (c.name in fills) this.err(c.span, `slot '${c.name}' is filled twice`)
      else if (!sig.outlets.has(c.name)) this.err(c.span, `<${el.tag}> has no slot '${c.name}'`)
      fills[c.name] = this.scoped(() => this.nodes(c.body))
    }
    if (rest.some((c) => !(c.k === 'text' && !c.value.trim()))) {
      if (!sig.outlets.has('')) {
        this.err(el.span, `<${el.tag}> has no default <slot /> for the content inside it`)
      } else {
        fills[''] = this.scoped(() => this.nodes(rest))
      }
    }
    const fa = this.attrs({ ...el, attrs: fallthrough })
    out.push({ k: 'cmp', n: name, in: inputs, fa, f: fills, at: at(el.span) })
  }

  // ── layouts ───────────────────────────────────────────────────────────

  /** The outlets a page can fill: its layout chain's. Reports bad names and cycles. */
  layoutChain(start: string | undefined, span: Span, page: string): Set<string> | undefined {
    const outlets = new Set<string>()
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
      for (const o of this.signature(name).outlets) outlets.add(o)
      name = ast.layout ?? undefined
    }
    return outlets
  }
}

/** Top-level elements, or -1 per other non-whitespace output (text, blocks). */
/** `import … from`, `export … from` or `import(`: a client script needs bundling for those. */
const IMPORTS = /(^|[\n;])\s*import[\s{*'"]|\bimport\s*\(|(^|[\n;])\s*export\s[^\n;]*\bfrom\s*['"]/

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
    if (n.k === 'comment' || n.k === 'let') continue
    roots.push(n.k === 'element' ? n : null)
  }
  return roots
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

  if (!component && ast.inputs.length) {
    for (const i of ast.inputs)
      c.diagnostics.push(error(ast.file, i.span, 'only components declare @input'))
  }
  const inputs = ast.inputs.map((i, idx) => {
    const s = idx
    const entry: CheckedTemplate['inputs'][number] = { n: i.name, s, r: !i.default }
    if (i.default) entry.d = i.default.value
    return entry
  })
  // Input slots come first, in declaration order.
  c.slots = inputs.length
  for (const i of inputs) c.bind(i.n, { kind: 'slot', s: i.s })

  // `<script client>`: the component's browser code, shipped as a module of
  // its own — lifted out of the template before anything else looks at it.
  const top: Node[] = []
  let client: CheckedTemplate['client']
  for (const n of ast.body) {
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
    if (IMPORTS.test(code)) {
      c.diagnostics.push(
        error(ast.file, n.span, "client scripts can't import yet — keep the script self-contained"),
      )
      continue
    }
    client = { code, js: false }
  }

  c.hasClientScript = client !== undefined
  if (component) {
    const roots = rootElements(top)
    if (roots.length === 1 && roots[0]) c.rootElement = roots[0]
  }

  // A page's top-level `@slot` blocks fill its layout's outlets.
  const fills: Record<string, CNode[]> = {}
  const body: Node[] = []
  const fillNodes: Array<Extract<Node, { k: 'slot-fill' }>> = []
  for (const n of top) {
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
  const layoutName = ast.layout === undefined ? mapped : (ast.layout ?? undefined)
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
    outlets = new Set([...(outlets ?? []), ...c.signature(base).outlets])
  }

  for (const f of fillNodes) {
    if (f.name in fills) {
      c.diagnostics.push(error(ast.file, f.span, `slot '${f.name}' is filled twice`))
      continue
    }
    if (!outlets) {
      // No layout is known here — a build that doesn't have the app's
      // mapping, say. Kept, and filled if the page gets a layout with it.
      c.diagnostics.push(warning(ast.file, f.span, `@slot('${f.name}') has no layout to fill here`))
      fills[f.name] = optimize(c.nodes(f.body))
      continue
    }
    if (!outlets.has(f.name)) {
      c.diagnostics.push(error(ast.file, f.span, `the layout has no slot '${f.name}'`))
      continue
    }
    fills[f.name] = optimize(c.nodes(f.body))
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
  if (ast.layout !== undefined) template.layout = ast.layout
  if (client) template.client = client
  const failed = c.diagnostics.some((d) => d.severity === 'error')
  return failed ? { diagnostics: c.diagnostics } : { template, diagnostics: c.diagnostics }
}
