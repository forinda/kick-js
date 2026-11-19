/**
 * What a page reads from its render data — for `kick typegen`, which turns it
 * into the type of `ctx.render(name, data)`. A walk over the parsed template
 * with its own scope (loop items, aliases and `@let`s point back at the data
 * they came from), separate from compiling: the compiler visits some bodies
 * more than once (fragment units), which would count reads twice.
 */
import type { Expr, Node, TemplateAst } from '../ast'
import { FORM_GLOBALS } from '../form-state'

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
  /** `@import type …` lines, as written. */
  imports: string[]
  /** Per `@fragment`: its needs (names bound around it) and the page data it reads. */
  fragments: Record<string, Record<string, Field>>
  /** The page's `@layout`: `null` for none, absent when it declares none. */
  layout?: string | null
}

// ── recording ───────────────────────────────────────────────────────────

/** One level of a read path while recording; turned into a `Field` at the end. */
interface Level {
  /** Read here without a guard: required. */
  required: boolean
  /** A loop source: may be null (`@for` shows `@empty`) even when required. */
  nullable: boolean
  /** A computed segment or a non-path use made this level opaque. */
  opaque: boolean
  props: Map<string, Level>
  item?: Level
  pair?: Level
}

const level = (): Level => ({ required: false, nullable: false, opaque: false, props: new Map() })

type Step = { p: string } | { item: true } | { pair: true }

/** Where a local name's value came from in the data, or null for a local of no data origin. */
type Origin = { root: string; steps: Step[] } | null

interface Binding {
  origin: Origin
  /** Scope depth it was bound at — a fragment reads names bound below its own depth as needs. */
  depth: number
}

/** A read: a data root and steps, with the levels it guards. */
interface Read {
  root: string
  steps: Step[]
  /** Levels (index into root + steps, 0 = root) read under a guard. */
  guarded: Set<number>
  /** Every level guarded (a condition or `??` operand). */
  all: boolean
  /** Opaque at the end (a computed segment followed). */
  opaqueEnd: boolean
}

class Summarizer {
  readonly roots = new Map<string, Level>()
  private readonly scopes: Array<Map<string, Binding>> = [new Map()]
  /** Paths a condition tested, for the branch it protects. */
  private readonly tested: Array<Array<{ root: string; steps: Step[] }>> = []
  /** Fragments being walked: their recorder and scope depth at entry. */
  private readonly frags: Array<{ roots: Map<string, Level>; depth: number }> = []
  readonly fragments = new Map<string, Map<string, Level>>()

  // ── scope ──

  private bind(name: string, origin: Origin): void {
    this.scopes[this.scopes.length - 1]!.set(name, { origin, depth: this.scopes.length - 1 })
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

  /** A path expression read as data, returning its origin (for aliases). */
  private path(e: Extract<Expr, { kind: 'path' }>, all: boolean): Origin {
    const steps: Step[] = []
    let opaqueEnd = false
    const guarded = new Set<number>()
    for (const [i, s] of e.segments.entries()) {
      // `a?.b`: the level holding `a` may be nullish.
      if (s.optional) guarded.add(i)
      if (s.computed) {
        this.expr(s.computed, false)
        opaqueEnd = true
        break
      }
      steps.push({ p: s.name! })
    }
    const b = this.lookup(e.root)
    let root = e.root
    let base: Step[] = []
    if (b) {
      if (!b.origin) return null
      root = b.origin.root
      base = b.origin.steps
    } else if (FORM_GLOBALS.has(e.root)) {
      return null
    }
    const full = [...base, ...steps]
    // Guard indexes are relative to the read's own path: shift past the origin.
    const shifted = new Set([...guarded].map((g) => g + base.length))
    // A condition earlier tested a prefix of this path: those levels are guarded.
    for (const frame of this.tested) {
      for (const t of frame) {
        if (t.root !== root || t.steps.length > full.length) continue
        if (t.steps.every((s, i) => sameStep(s, full[i]!))) shifted.add(t.steps.length)
      }
    }
    const read: Read = { root, steps: full, guarded: shifted, all, opaqueEnd }
    this.recordInto(this.roots, read)
    for (const f of this.frags) {
      // A name bound around the fragment is one of its needs, by its own
      // name; anything else is page data the fragment reads.
      if (b && b.depth < f.depth) {
        this.recordInto(f.roots, { root: e.root, steps, guarded, all, opaqueEnd })
      } else this.recordInto(f.roots, read)
    }
    return opaqueEnd ? null : { root, steps: full }
  }

  private recordInto(roots: Map<string, Level>, r: Read): void {
    let lv = roots.get(r.root)
    if (!lv) roots.set(r.root, (lv = level()))
    const touch = (l: Level, at: number) => {
      if (!r.all && !r.guarded.has(at)) l.required = true
    }
    touch(lv, 0)
    for (const [i, s] of r.steps.entries()) {
      let next: Level | undefined
      if ('p' in s) {
        next = lv.props.get(s.p)
        if (!next) lv.props.set(s.p, (next = level()))
      } else if ('item' in s) next = lv.item ??= level()
      else next = lv.pair ??= level()
      lv = next
      touch(lv, i + 1)
    }
    if (r.opaqueEnd) lv.opaque = true
  }

  /** Mark an origin as a loop source (nullable list or pairs). */
  private loopSource(o: Origin, pairs: boolean): Origin {
    if (!o) return null
    let lv = this.roots.get(o.root)
    for (const s of o.steps) {
      if (!lv) break
      lv = 'p' in s ? lv.props.get(s.p) : 'item' in s ? lv.item : lv.pair
    }
    if (lv) {
      lv.nullable = true
      if (pairs) lv.pair ??= level()
      else lv.item ??= level()
    }
    return { root: o.root, steps: [...o.steps, pairs ? { pair: true } : { item: true }] }
  }

  // ── expressions ──

  /** Walk an expression; `all`: every read in it is guarded (a condition, `??` left side). */
  expr(e: Expr, all: boolean): Origin {
    switch (e.kind) {
      case 'literal':
        return null
      case 'path':
        return this.path(e, all)
      case 'unary':
        // `!x` tests x.
        this.expr(e.arg, all || e.op === '!')
        return null
      case 'binary':
        this.expr(e.left, all)
        this.expr(e.right, all)
        return null
      case 'logical':
        if (e.op === '??') {
          this.expr(e.left, true)
          this.expr(e.right, all)
        } else if (e.op === '&&') {
          // `a && a.b`: the right side runs only when the left held.
          this.expr(e.left, true)
          this.guardedBy(e.left, () => this.expr(e.right, all))
        } else {
          this.expr(e.left, true)
          this.expr(e.right, all)
        }
        return null
      case 'conditional':
        this.expr(e.test, true)
        this.guardedBy(e.test, () => this.expr(e.whenTrue, all))
        this.expr(e.whenFalse, all)
        return null
      case 'pipe':
        this.expr(e.input, all)
        for (const a of e.args) this.expr(a, all)
        return null
    }
  }

  /** Run `fn` with the paths `cond` tests guarding their levels. */
  private guardedBy(cond: Expr, fn: () => void): void {
    this.tested.push(testedPaths(cond, (n) => this.lookup(n)))
    try {
      fn()
    } finally {
      this.tested.pop()
    }
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
          if (a.expr) this.expr(a.expr, false)
          for (const p of a.parts ?? []) if (typeof p !== 'string') this.expr(p, false)
        }
        stack.push({ list: n.children, i: 0 })
      } else this.node(n)
    }
  }

  private node(n: Node): void {
    switch (n.k) {
      case 'interp':
        this.expr(n.expr, false)
        return
      case 'comment':
        this.nodes(n.children)
        return
      case 'if': {
        // A branch runs when its condition held and the earlier ones didn't:
        // only its own condition guards it.
        for (const br of n.branches) {
          const origin = br.cond ? this.expr(br.cond, true) : null
          this.scoped(() => {
            if (br.alias) this.bind(br.alias, origin)
            if (br.cond) this.guardedBy(br.cond, () => this.nodes(br.body))
            else this.nodes(br.body)
          })
        }
        return
      }
      case 'for': {
        const source = this.loopSource(this.expr(n.of, false), Array.isArray(n.item))
        this.scoped(() => {
          if (Array.isArray(n.item)) {
            this.bind(n.item[0], null)
            this.bind(n.item[1], source)
          } else this.bind(n.item, source)
          for (const name of Object.keys(n.lets)) this.bind(name, null)
          this.nodes(n.body)
        })
        if (n.empty) this.scoped(() => this.nodes(n.empty!))
        return
      }
      case 'switch':
        this.expr(n.on, false)
        for (const c of n.cases) {
          this.expr(c.value, false)
          this.scoped(() => this.nodes(c.body))
        }
        if (n.default) this.scoped(() => this.nodes(n.default!))
        return
      case 'let':
        this.bind(n.name, this.expr(n.expr, false))
        return
      case 'slot-outlet':
        for (const o of n.offers) this.expr(o.expr, false)
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
        const roots = this.fragments.get(n.name) ?? new Map<string, Level>()
        this.fragments.set(n.name, roots)
        this.frags.push({ roots, depth: this.scopes.length })
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
        for (const a of n.args) this.expr(a, false)
        return
      default:
        return
    }
  }
}

const sameStep = (a: Step, b: Step): boolean =>
  'p' in a ? 'p' in b && a.p === b.p : 'item' in a ? 'item' in b : 'pair' in b

/** The data paths a condition tests (resolved through aliases): `a`, `a.b`, each side of `&&`. */
function testedPaths(
  cond: Expr,
  lookup: (name: string) => Binding | undefined,
): Array<{ root: string; steps: Step[] }> {
  const out: Array<{ root: string; steps: Step[] }> = []
  const visit = (e: Expr) => {
    if (e.kind === 'logical' && e.op === '&&') {
      visit(e.left)
      visit(e.right)
    } else if (e.kind === 'path' && e.segments.every((s) => !s.computed)) {
      const b = lookup(e.root)
      if (b && !b.origin) return
      const base = b?.origin ?? { root: e.root, steps: [] }
      out.push({
        root: base.root,
        steps: [...base.steps, ...e.segments.map((s) => ({ p: s.name! }))],
      })
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
  return { shape: shapeOf(l), optional: !l.required, nullable: !l.required || l.nullable }
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
  for (const [name, roots] of s.fragments) fragments[name] = fieldsOf(roots)
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
    imports: [...new Set([...into.imports, ...from.imports])],
  }
}
