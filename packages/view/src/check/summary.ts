/**
 * What a page reads from its render data — for `kick typegen`, which turns it
 * into the type of `ctx.render(name, data)`. A walk over the parsed template
 * with its own scope (loop items, aliases and `@let`s point back at the data
 * they came from), separate from compiling: the compiler visits some bodies
 * more than once (fragment units), which would count reads twice.
 */
import type { Expr, Node, TemplateAst } from '../ast'
import { FORM_GLOBALS } from '../form-state'

const LOOP_VARS = new Set(['$index', '$first', '$last', '$even', '$odd', '$count'])

/** The shape of a value, as far as the template's reads reveal it. */
export type Shape =
  | { k: 'unknown' }
  | { k: 'object'; props: Record<string, Field> }
  | { k: 'list'; item: Shape }
  | { k: 'pairs'; value: Shape }

/** A name or property: its shape, and whether it may be missing / null. */
export interface Field {
  shape: Shape
  optional: boolean
  nullable: boolean
}

/** What a page reads, declares and imports. */
export interface DataSummary {
  fields: Record<string, Field>
  /** `@input name: Type` in the page: its type, and optional when it has a default. */
  declared: Record<string, { type?: string; optional: boolean }>
  /** `@input name = value` defaults. */
  defaults?: Record<string, unknown>
  /** `@import type …` lines, as written. */
  imports: string[]
  /**
   * Per `@fragment`: its needs (names bound around it — the caller passes
   * them, `share()` doesn't count) and the page data it reads.
   */
  fragments: Record<string, { needs: Record<string, Field>; reads: Record<string, Field> }>
  /** The page's `@layout`: `null` for none, absent when it declares none. */
  layout?: string | null
}

// ── recording ───────────────────────────────────────────────────────────

/** One level of a read path while recording; turned into a `Field` at the end. */
interface Level {
  /** Some read needs the name present (a missing one warns at render). */
  present: boolean
  /** Some read needs it non-null. */
  nonNull: boolean
  /** A loop source: may be null (`@for` shows `@empty`). */
  loop: boolean
  /** A computed segment made this level opaque. */
  opaque: boolean
  props: Map<string, Level>
  item?: Level
  pair?: Level
}

const level = (): Level => ({
  present: false,
  nonNull: false,
  loop: false,
  opaque: false,
  props: new Map(),
})

type Step = { p: string } | { item: true } | { pair: true }

/**
 * How a read treats the levels it touches: `use` needs them present and
 * non-null; `test` (a condition) present, maybe null; `soft` (`??`, `?.`)
 * neither.
 */
type Mode = 'use' | 'test' | 'soft'

/** A local name: what it's bound to, at which scope depth. */
interface Binding {
  depth: number
  /** Data root, another local, or nothing data-shaped (a loop counter, a computed @let). */
  src: { k: 'data'; root: string } | { k: 'var'; name: string; b: Binding } | null
  /** Steps from `src` to the value. */
  steps: Step[]
}

/** What a binding to an expression points at: its data root or local, and steps. */
interface Target {
  src: Binding['src']
  steps: Step[]
}

/** One read to record: root, steps, a mode per level (0 = root), opaque end, loop marker. */
interface Read {
  root: string
  steps: Step[]
  modes: Mode[]
  opaqueEnd: boolean
  loop?: 'item' | 'pair'
}

class Summarizer {
  readonly roots = new Map<string, Level>()
  private readonly scopes: Array<Map<string, Binding>> = [new Map()]
  /** Paths a condition tested (as data reads or locals), for the branch it protects. */
  private readonly tested: Array<Array<{ root: string; steps: Step[]; local?: Binding }>> = []
  /** Fragments being walked: their recorders and scope depth at entry. */
  private readonly frags: Array<{
    needs: Map<string, Level>
    reads: Map<string, Level>
    depth: number
  }> = []
  readonly fragments = new Map<string, { needs: Map<string, Level>; reads: Map<string, Level> }>()
  /** Set while walking an `@for` source: the read it makes is a loop source. */
  private loopNext?: 'item' | 'pair'

  // ── scope ──

  private bind(name: string, src: Binding['src'], steps: Step[] = []): Binding {
    const b: Binding = { depth: this.scopes.length - 1, src, steps }
    this.scopes[this.scopes.length - 1]!.set(name, b)
    return b
  }
  private lookup(name: string): Binding | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const b = this.scopes[i]!.get(name)
      if (b) return b
    }
    return undefined
  }
  private scoped(fn: () => void): void {
    this.scopes.push(new Map())
    try {
      fn()
    } finally {
      this.scopes.pop()
    }
  }

  // ── reads ──

  /**
   * A path read. Returns what a binding to it should point at: the data root
   * or local it reads, with its steps (null when it isn't a plain path).
   */
  private path(e: Extract<Expr, { kind: 'path' }>, mode: Mode): Target | null {
    const loop = this.loopNext
    this.loopNext = undefined
    if (LOOP_VARS.has(e.root)) return null
    const steps: Step[] = []
    const own: Mode[] = [mode]
    let opaqueEnd = false
    for (const s of e.segments) {
      // `a?.b`: the level holding `a` may be missing or null.
      if (s.optional) own[own.length - 1] = 'soft'
      if (s.computed) {
        this.expr(s.computed, 'use')
        opaqueEnd = true
        break
      }
      steps.push({ p: s.name! })
      own.push(mode)
    }
    const b = this.lookup(e.root)
    if (!b && FORM_GLOBALS.has(e.root)) return null
    // The page's view: follow locals back to data.
    const page = b ? this.resolve(b, steps, own) : { root: e.root, steps, modes: own }
    if (page) this.recordInto(this.roots, this.guarded({ ...page, opaqueEnd, loop }))
    // Each fragment's view: stop at the first name bound around it (a need).
    for (const f of this.frags) {
      const r = b ? this.resolveFor(f.depth, e.root, b, steps, own) : null
      if (r?.need) this.recordInto(f.needs, this.guarded({ ...r.read, opaqueEnd, loop }))
      else if (r) this.recordInto(f.reads, this.guarded({ ...r.read, opaqueEnd, loop }))
      else if (!b)
        this.recordInto(f.reads, this.guarded({ root: e.root, steps, modes: own, opaqueEnd, loop }))
    }
    if (opaqueEnd) return null
    return b
      ? { src: { k: 'var', name: e.root, b }, steps }
      : { src: { k: 'data', root: e.root }, steps }
  }

  /** A local's read, as a data read: its source's steps first. */
  private resolve(
    b: Binding,
    steps: Step[],
    modes: Mode[],
  ): { root: string; steps: Step[]; modes: Mode[] } | null {
    const chain: Binding[] = []
    for (let cur = b; ; cur = cur.src.b) {
      if (!cur.src) return null
      chain.push(cur)
      if (cur.src.k === 'data') return joined(cur.src.root, chain, steps, modes)
    }
  }

  /**
   * A local's read as fragment `depth` sees it: a need (by the first name
   * bound around it), or page data.
   */
  private resolveFor(
    depth: number,
    name: string,
    b: Binding,
    steps: Step[],
    modes: Mode[],
  ): { need: boolean; read: { root: string; steps: Step[]; modes: Mode[] } } | null {
    const chain: Binding[] = []
    let curName = name
    for (let cur = b; ;) {
      if (cur.depth < depth) return { need: true, read: joined(curName, chain, steps, modes) }
      if (!cur.src) return null
      chain.push(cur)
      if (cur.src.k === 'data') {
        return { need: false, read: joined(cur.src.root, chain, steps, modes) }
      }
      curName = cur.src.name
      cur = cur.src.b
    }
  }

  /** Levels a condition tested (for the branch it protects) count as tested, not used. */
  private guarded(r: Read): Read {
    const modes = [...r.modes]
    for (const frame of this.tested) {
      for (const t of frame) {
        if (t.root !== r.root || t.steps.length > r.steps.length) continue
        if (!t.steps.every((s, i) => sameStep(s, r.steps[i]!))) continue
        for (let i = 0; i <= t.steps.length; i++) if (modes[i] === 'use') modes[i] = 'test'
      }
    }
    return { ...r, modes }
  }

  private recordInto(roots: Map<string, Level>, r: Read): void {
    let lv = roots.get(r.root)
    if (!lv) roots.set(r.root, (lv = level()))
    const touch = (l: Level, m: Mode | undefined) => {
      if (m === 'use' || m === 'test') l.present = true
      if (m === 'use') l.nonNull = true
    }
    touch(lv, r.modes[0])
    for (const [i, s] of r.steps.entries()) {
      let next: Level | undefined
      if ('p' in s) {
        next = lv.props.get(s.p)
        if (!next) lv.props.set(s.p, (next = level()))
      } else if ('item' in s) next = lv.item ??= level()
      else next = lv.pair ??= level()
      lv = next
      touch(lv, r.modes[i + 1])
    }
    if (r.opaqueEnd) lv.opaque = true
    if (r.loop) {
      lv.loop = true
      if (r.loop === 'pair') lv.pair ??= level()
      else lv.item ??= level()
    }
  }

  // ── expressions ──

  /** Walk an expression; returns what a binding to it points at (plain paths only). */
  expr(e: Expr, mode: Mode): Target | null {
    switch (e.kind) {
      case 'literal':
        return null
      case 'path':
        return this.path(e, mode)
      case 'unary':
        this.expr(e.arg, e.op === '!' && mode === 'use' ? 'test' : mode)
        return null
      case 'binary':
        this.expr(e.left, mode)
        this.expr(e.right, mode)
        return null
      case 'logical':
        if (e.op === '??') {
          this.expr(e.left, 'soft')
          this.expr(e.right, mode)
        } else if (e.op === '&&') {
          // `a && a.b`: the right side runs only when the left held.
          this.expr(e.left, mode === 'use' ? 'test' : mode)
          this.guardedBy([e.left], () => this.expr(e.right, mode))
        } else {
          this.expr(e.left, mode === 'use' ? 'test' : mode)
          this.expr(e.right, mode)
        }
        return null
      case 'conditional':
        this.expr(e.test, mode === 'use' ? 'test' : mode)
        this.guardedBy([e.test], () => this.expr(e.whenTrue, mode))
        this.expr(e.whenFalse, mode)
        return null
      case 'pipe':
        this.expr(e.input, mode)
        for (const a of e.args) this.expr(a, 'use')
        return null
    }
  }

  /** Run `fn` with the paths `conds` test guarding their levels. */
  private guardedBy(conds: Expr[], fn: () => void): void {
    this.tested.push(conds.flatMap((c) => testedPaths(c, (n) => this.lookup(n), this)))
    try {
      fn()
    } finally {
      this.tested.pop()
    }
  }

  /** A path as data: through locals to their data root (for guards). */
  dataPath(root: string, steps: Step[]): { root: string; steps: Step[] } | null {
    const b = this.lookup(root)
    if (!b) return FORM_GLOBALS.has(root) || LOOP_VARS.has(root) ? null : { root, steps }
    const r = this.resolve(b, steps, steps.map((): Mode => 'use').concat('use'))
    return r ? { root: r.root, steps: r.steps } : null
  }

  // ── nodes ──

  /** Elements are walked with an explicit stack, as the checker does: deep markup can't overflow. */
  nodes(list: Node[]): void {
    const stack: Array<{ list: Node[]; i: number }> = [{ list, i: 0 }]
    while (stack.length) {
      const f = stack[stack.length - 1]!
      if (f.i >= f.list.length) {
        stack.pop()
        continue
      }
      const n = f.list[f.i++]!
      if (n.k === 'element') {
        for (const a of n.attrs) {
          if (a.expr) this.expr(a.expr, 'use')
          for (const p of a.parts ?? []) if (typeof p !== 'string') this.expr(p, 'use')
        }
        stack.push({ list: n.children, i: 0 })
      } else this.node(n)
    }
  }

  private bindTo(name: string, to: Target | null, extra: Step[] = []): void {
    if (!to) this.bind(name, null)
    else this.bind(name, to.src, [...to.steps, ...extra])
  }

  private node(n: Node): void {
    switch (n.k) {
      case 'interp':
        this.expr(n.expr, 'use')
        return
      case 'comment':
        this.nodes(n.children)
        return
      case 'if': {
        // A branch runs when its condition held and the earlier ones didn't:
        // its condition guards it, and so does the x of an earlier `@if (!x)`.
        const negated: Expr[] = []
        for (const br of n.branches) {
          const to = br.cond ? this.expr(br.cond, 'test') : null
          const guards = [...(br.cond ? [br.cond] : []), ...negated]
          this.scoped(() => {
            if (br.alias) this.bindTo(br.alias, to)
            this.guardedBy(guards, () => this.nodes(br.body))
          })
          if (br.cond?.kind === 'unary' && br.cond.op === '!') negated.push(br.cond.arg)
        }
        return
      }
      case 'for': {
        const pairs = Array.isArray(n.item)
        this.loopNext = pairs ? 'pair' : 'item'
        const to = this.expr(n.of, 'test')
        this.loopNext = undefined
        this.scoped(() => {
          if (pairs) {
            this.bind(n.item[0], null)
            this.bindTo(n.item[1], to, [{ pair: true }])
          } else this.bindTo(n.item as string, to, [{ item: true }])
          for (const name of Object.keys(n.lets)) this.bind(name, null)
          this.nodes(n.body)
        })
        if (n.empty) this.scoped(() => this.nodes(n.empty!))
        return
      }
      case 'switch':
        this.expr(n.on, 'use')
        for (const c of n.cases) {
          this.expr(c.value, 'use')
          this.scoped(() => this.nodes(c.body))
        }
        if (n.default) this.scoped(() => this.nodes(n.default!))
        return
      case 'let':
        // An alias reads its source (present), but only its uses decide more.
        this.bindTo(n.name, this.expr(n.expr, 'test'))
        return
      case 'slot-outlet':
        for (const o of n.offers) this.expr(o.expr, 'use')
        this.scoped(() => {
          for (const o of n.offers) this.bind(o.name, null)
          this.nodes(n.fallback)
        })
        return
      case 'slot-fill':
        this.scoped(() => {
          for (const l of n.lets) this.bind(l.name, null)
          this.nodes(n.body)
        })
        return
      case 'push':
        this.scoped(() => this.nodes(n.body))
        return
      case 'fragment': {
        const own = this.fragments.get(n.name) ?? { needs: new Map(), reads: new Map() }
        this.fragments.set(n.name, own)
        this.frags.push({ ...own, depth: this.scopes.length })
        try {
          this.scoped(() => this.nodes(n.body))
        } finally {
          this.frags.pop()
        }
        return
      }
      case 'snippet': {
        // A snippet sees its parameters and page data, nothing from around it.
        const outer = this.scopes.splice(0)
        this.scopes.push(new Map())
        try {
          for (const p of n.params) this.bind(p.name, null)
          this.nodes(n.body)
        } finally {
          this.scopes.splice(0, this.scopes.length, ...outer)
        }
        return
      }
      case 'render':
        for (const a of n.args) this.expr(a, 'use')
        return
      default:
        return
    }
  }
}

/**
 * A read through `chain` (innermost binding first): each binding's own steps
 * go before the read's, outermost first. A binding's steps were read when it
 * was bound — present, maybe null — so they count as tested.
 */
function joined(
  root: string,
  chain: Binding[],
  steps: Step[],
  modes: Mode[],
): { root: string; steps: Step[]; modes: Mode[] } {
  const outer = chain.toReversed()
  const allSteps = [...outer.flatMap((c) => c.steps), ...steps]
  const allModes = [...outer.flatMap((c) => c.steps.map((): Mode => 'test')), ...modes]
  return { root, steps: allSteps, modes: fixModes(allModes, allSteps.length) }
}

/** `modes` for `n` steps plus the root, padded with 'use'. */
function fixModes(modes: Mode[], n: number): Mode[] {
  const out = modes.slice(modes.length - (n + 1))
  while (out.length < n + 1) out.unshift('use')
  return out
}

const sameStep = (a: Step, b: Step): boolean =>
  'p' in a ? 'p' in b && a.p === b.p : 'item' in a ? 'item' in b : 'pair' in b

/** The data paths a condition tests (resolved through locals): `a`, `a.b`, each side of `&&`, `!a`'s a when negated. */
function testedPaths(
  cond: Expr,
  _lookup: (name: string) => Binding | undefined,
  s: Summarizer,
): Array<{ root: string; steps: Step[] }> {
  const out: Array<{ root: string; steps: Step[] }> = []
  const visit = (e: Expr) => {
    if (e.kind === 'logical' && e.op === '&&') {
      visit(e.left)
      visit(e.right)
    } else if (e.kind === 'path' && e.segments.every((x) => !x.computed)) {
      const p = s.dataPath(
        e.root,
        e.segments.map((x) => ({ p: x.name! })),
      )
      if (p) out.push(p)
    }
  }
  visit(cond)
  return out
}

// ── output ──────────────────────────────────────────────────────────────

function shapeOf(l: Level): Shape {
  if (l.opaque) return { k: 'unknown' }
  if (l.pair) return { k: 'pairs', value: shapeOf(l.pair) }
  if (l.item) return { k: 'list', item: shapeOf(l.item) }
  if (l.props.size) {
    const props: Record<string, Field> = {}
    for (const [name, child] of [...l.props].toSorted(([a], [b]) => a.localeCompare(b))) {
      props[name] = fieldOf(child)
    }
    return { k: 'object', props }
  }
  return { k: 'unknown' }
}

function fieldOf(l: Level): Field {
  return { shape: shapeOf(l), optional: !l.present, nullable: !l.nonNull || l.loop }
}

function fieldsOf(roots: Map<string, Level>): Record<string, Field> {
  const out: Record<string, Field> = {}
  for (const [name, l] of [...roots].toSorted(([a], [b]) => a.localeCompare(b)))
    out[name] = fieldOf(l)
  return out
}

/** The data summary of a page or layout. */
export function summarize(ast: TemplateAst): DataSummary {
  const s = new Summarizer()
  s.nodes(ast.body)
  const declared: DataSummary['declared'] = {}
  for (const i of ast.inputs) {
    declared[i.name] = { ...(i.type ? { type: i.type } : {}), optional: i.default !== undefined }
  }
  const fragments: DataSummary['fragments'] = {}
  for (const [name, f] of s.fragments) {
    fragments[name] = { needs: fieldsOf(f.needs), reads: fieldsOf(f.reads) }
  }
  return {
    fields: fieldsOf(s.roots),
    declared,
    imports: ast.typeImports ?? [],
    fragments,
    ...(ast.layout !== undefined ? { layout: ast.layout } : {}),
  }
}

// ── merging (layouts into the page that uses them) ──────────────────────

function mergeShape(a: Shape, b: Shape): Shape {
  if (a.k === 'unknown') return b
  if (b.k === 'unknown') return a
  if (a.k === 'object' && b.k === 'object') {
    const props = { ...a.props }
    for (const [k, v] of Object.entries(b.props)) props[k] = props[k] ? merge(props[k]!, v) : v
    return { k: 'object', props }
  }
  if (a.k === 'list' && b.k === 'list') return { k: 'list', item: mergeShape(a.item, b.item) }
  if (a.k === 'pairs' && b.k === 'pairs') return { k: 'pairs', value: mergeShape(a.value, b.value) }
  return { k: 'unknown' }
}

/** Two reads of one field: required if either requires it, shapes merged. */
export function merge(a: Field, b: Field): Field {
  return {
    shape: mergeShape(a.shape, b.shape),
    optional: a.optional && b.optional,
    nullable:
      (a.nullable && b.nullable) || (!a.optional && a.nullable) || (!b.optional && b.nullable),
  }
}

/** `from`'s fields merged into `into` (a layout's reads into its page's). */
export function mergeSummary(into: DataSummary, from: DataSummary): DataSummary {
  const fields = { ...into.fields }
  for (const [k, v] of Object.entries(from.fields)) fields[k] = fields[k] ? merge(fields[k]!, v) : v
  return {
    ...into,
    fields,
    declared: { ...from.declared, ...into.declared },
    // Imports stay with the template that wrote them: typegen emits each
    // template's, resolved from that template's own folder.
  }
}
