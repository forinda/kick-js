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
  src:
    | { k: 'data'; root: string }
    | { k: 'var'; name: string; b: Binding }
    /** One of several (`a ? xs : ys`, `xs ?? ys`): reads go to each. */
    | { k: 'either'; options: Target[] }
    | null
  /** Steps from `src` to the value. */
  steps: Step[]
  /** The left of a `??`: levels up to this many steps may be missing (the fallback covers them). */
  softAt?: number
}

/** What a binding to an expression points at: its data root or local, and steps. */
interface Target {
  src: Binding['src']
  steps: Step[]
  /** The left of a `??` (see {@link Binding.softAt}). */
  soft?: true
}

/** An `@for` source read: the list's items, or a Map's pairs. */
type Loop = 'item' | 'pair'

/** One read to record: root, steps, a mode per level (0 = root), opaque end, loop marker. */
interface Read {
  root: string
  steps: Step[]
  modes: Mode[]
  opaqueEnd: boolean
  loop?: Loop
}

class Summarizer {
  readonly roots = new Map<string, Level>()
  private readonly scopes: Array<Map<string, Binding>> = [new Map()]
  /** Paths a condition tested (as data reads or locals), for the branch it protects. */
  private readonly tested: Array<Array<{ root: string; steps: Step[]; local?: Binding }>> = []
  /** Fragments being walked: their recorders and scope depth at entry. */
  private readonly frags: Array<{
    name: string
    needs: Map<string, Level>
    reads: Map<string, Level>
    depth: number
    /** Guard frames at entry: only later ones hold for its standalone render. */
    tested: number
  }> = []
  /** The snippet whose body is being walked, if any. */
  private snippet?: string
  /** Each snippet's page reads, and the snippets it renders. */
  readonly snippetReads = new Map<string, Map<string, Level>>()
  readonly snippetCalls = new Map<string, Set<string>>()
  /** The snippets the page renders outside any snippet. */
  readonly pageCalls = new Set<string>()
  /** The snippets each fragment renders directly. */
  readonly fragmentCalls = new Map<string, Set<string>>()
  readonly fragments = new Map<string, { needs: Map<string, Level>; reads: Map<string, Level> }>()

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
  private path(e: Extract<Expr, { kind: 'path' }>, mode: Mode, loop?: Loop): Target | null {
    if (LOOP_VARS.has(e.root)) return null
    const steps: Step[] = []
    const own: Mode[] = [mode]
    let opaqueEnd = false
    // After a `?.`, the rest of the path (computed keys too) may not run.
    let skippable = false
    for (const s of e.segments) {
      // `a?.b`: the level holding `a` may be missing or null.
      if (s.optional) {
        if (!opaqueEnd) own[own.length - 1] = 'soft'
        skippable = true
      }
      if (s.computed) {
        // Every key expression is read, also after the first computed one.
        this.expr(s.computed, skippable ? 'soft' : 'use')
        opaqueEnd = true
        continue
      }
      if (!opaqueEnd) {
        steps.push({ p: s.name! })
        own.push(mode)
      }
    }
    const b = this.lookup(e.root)
    if (!b && FORM_GLOBALS.has(e.root)) return null
    // The page's view: follow locals back to data.
    const pages = b ? this.resolve(b, steps, own) : [{ root: e.root, steps, modes: own }]
    for (const page of pages) {
      const read = this.guarded({ ...page, opaqueEnd, loop })
      // A snippet's reads count where it's rendered (the page, a fragment).
      this.recordInto(this.snippet ? this.snippetReads.get(this.snippet)! : this.roots, read)
    }
    // Each fragment's view: stop at the first name bound around it (a need).
    // Only guards set up inside the fragment hold: a standalone render skips
    // the page's conditions around it.
    for (const f of this.frags) {
      if (!b) {
        const read = { root: e.root, steps, modes: own, opaqueEnd, loop }
        this.recordInto(f.reads, this.guarded(read, f.tested))
        continue
      }
      for (const r of this.resolveFor(f.depth, e.root, b, steps, own)) {
        const read = this.guarded({ ...r.read, opaqueEnd, loop }, f.tested)
        if (!r.need) {
          this.recordInto(f.reads, read)
          continue
        }
        // The render checks a need is present before anything reads it.
        if (read.modes[0] === 'soft') read.modes[0] = 'test'
        this.recordInto(f.needs, read)
      }
    }
    if (opaqueEnd) return null
    return b
      ? { src: { k: 'var', name: e.root, b }, steps }
      : { src: { k: 'data', root: e.root }, steps }
  }

  /** A local's reads, as data reads: its source's steps first (one per source it may be). */
  private resolve(
    b: Binding,
    steps: Step[],
    modes: Mode[],
  ): Array<{ root: string; steps: Step[]; modes: Mode[] }> {
    return this.resolveFor(-1, '', b, steps, modes).map((r) => r.read)
  }

  /**
   * A local's reads as fragment `depth` sees them: a need (by the first name
   * bound around it), or page data. `depth` -1: the page itself (no needs).
   */
  private resolveFor(
    depth: number,
    name: string,
    b: Binding,
    steps: Step[],
    modes: Mode[],
  ): Array<{ need: boolean; read: { root: string; steps: Step[]; modes: Mode[] } }> {
    const out: Array<{ need: boolean; read: { root: string; steps: Step[]; modes: Mode[] } }> = []
    // `@let b = f ? a : a` chains reach one binding many ways: walk each
    // (binding, steps so far) once, or the reads grow exponentially.
    const seen = new Map<object, Set<string>>()
    const walk = (curName: string, cur: Binding, chain: Binding[]) => {
      if (cur.src) {
        const key = JSON.stringify([
          curName,
          cur.depth,
          cur.steps,
          cur.softAt,
          chain.map((c) => [c.steps, c.softAt]),
        ])
        const keys = seen.get(cur.src) ?? new Set<string>()
        if (keys.has(key)) return
        seen.set(cur.src, keys.add(key))
      }
      if (cur.depth < depth) {
        out.push({ need: true, read: joined(curName, chain, steps, modes) })
        return
      }
      const src = cur.src
      if (!src) return
      if (src.k === 'either') {
        // The binding's own steps apply after whichever option it took.
        for (const o of src.options) {
          const via: Binding = { depth: cur.depth, src: o.src, steps: [...o.steps, ...cur.steps] }
          if (o.soft) via.softAt = o.steps.length
          walk(curName, via, chain)
        }
        return
      }
      const next = [...chain, cur]
      if (src.k === 'data') out.push({ need: false, read: joined(src.root, next, steps, modes) })
      else walk(src.name, src.b, next)
    }
    walk(name, b, [])
    return out
  }

  /** Levels a condition tested (for the branch it protects) count as tested, not used. */
  private guarded(r: Read, from = 0): Read {
    const modes = [...r.modes]
    for (const frame of this.tested.slice(from)) {
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
  /** Walk an expression; `loop`: its result is an `@for` source (passed to the branches that produce it). */
  expr(e: Expr, mode: Mode, loop?: Loop): Target | null {
    switch (e.kind) {
      case 'literal':
        return null
      case 'path':
        return this.path(e, mode, loop)
      case 'unary': {
        // An operator reads its operands before any `??` around it can step in.
        const m = mode === 'soft' ? 'use' : mode
        this.expr(e.arg, e.op === '!' && m === 'use' ? 'test' : m)
        return null
      }
      case 'binary': {
        const m = mode === 'soft' ? 'use' : mode
        this.expr(e.left, m)
        this.expr(e.right, m)
        return null
      }
      case 'logical':
        // Either side can be the result: both carry the loop.
        if (e.op === '??') {
          const left = this.expr(e.left, 'soft', loop)
          return either(left && { ...left, soft: true }, this.expr(e.right, mode, loop))
        }
        if (e.op === '&&') {
          // `a && a.b`: the right side runs only when the left held.
          this.expr(e.left, mode === 'use' ? 'test' : mode, loop)
          let right: Target | null = null
          this.guardedBy([e.left], () => (right = this.expr(e.right, mode, loop)))
          return right
        }
        return either(
          this.expr(e.left, mode === 'use' ? 'test' : mode, loop),
          this.expr(e.right, mode, loop),
        )
      case 'conditional':
        // The test only picks; the branches are the result.
        this.expr(e.test, mode === 'use' ? 'test' : mode)
        let yes: Target | null = null
        this.guardedBy([e.test], () => (yes = this.expr(e.whenTrue, mode, loop)))
        return either(yes, this.expr(e.whenFalse, mode, loop))
      case 'pipe':
        // The pipe's result is what's looped over, not its input.
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

  /** A path as data: through locals to the data they may be (for guards). */
  dataPaths(root: string, steps: Step[]): Array<{ root: string; steps: Step[] }> {
    const b = this.lookup(root)
    if (!b) return FORM_GLOBALS.has(root) || LOOP_VARS.has(root) ? [] : [{ root, steps }]
    return this.resolve(b, steps, [...steps.map((): Mode => 'use'), 'use']).map((r) => ({
      root: r.root,
      steps: r.steps,
    }))
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
    else {
      const b = this.bind(name, to.src, [...to.steps, ...extra])
      if (to.soft) b.softAt = to.steps.length
    }
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
        const to = this.expr(n.of, 'test', pairs ? 'pair' : 'item')
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
        this.frags.push({
          name: n.name,
          ...own,
          depth: this.scopes.length,
          tested: this.tested.length,
        })
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
        this.snippet = n.name
        if (!this.snippetReads.has(n.name)) this.snippetReads.set(n.name, new Map())
        try {
          for (const p of n.params) this.bind(p.name, null)
          this.nodes(n.body)
        } finally {
          this.snippet = undefined
          this.scopes.splice(0, this.scopes.length, ...outer)
        }
        return
      }
      case 'render':
        for (const a of n.args) this.expr(a, 'use')
        if (this.snippet) add(this.snippetCalls, this.snippet, n.name)
        else this.pageCalls.add(n.name)
        for (const f of this.frags) add(this.fragmentCalls, f.name, n.name)
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
  const allModes = fixModes(
    [...outer.flatMap((c) => c.steps.map((): Mode => 'test')), ...modes],
    allSteps.length,
  )
  // A `??`'s left side (`@let x = a.b ?? y`): its levels may be missing.
  let at = 0
  for (const c of outer) {
    if (c.softAt !== undefined) {
      for (let i = 0; i <= at + c.softAt; i++) allModes[i] = 'soft'
    }
    at += c.steps.length
  }
  return { root, steps: allSteps, modes: allModes }
}

/** A value that is one of these (the ones that are plain paths). */
function either(...targets: Array<Target | null>): Target | null {
  const options = targets.filter((t): t is Target => t !== null)
  if (options.length < 2) return options[0] ?? null
  return { src: { k: 'either', options }, steps: [] }
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>()
  set.add(value)
  map.set(key, set)
}

/** `from`'s levels merged into `into` (a called snippet's reads into a fragment's). */
function mergeLevels(into: Map<string, Level>, from: Map<string, Level>): void {
  for (const [name, l] of from) {
    const target = into.get(name)
    if (target) mergeLevel(target, l)
    else into.set(name, cloneLevel(l))
  }
}

function cloneLevel(l: Level): Level {
  const out = level()
  mergeLevel(out, l)
  return out
}

function mergeLevel(into: Level, l: Level): void {
  into.present ||= l.present
  into.nonNull ||= l.nonNull
  into.loop ||= l.loop
  into.opaque ||= l.opaque
  mergeLevels(into.props, l.props)
  if (l.item) {
    if (into.item) mergeLevel(into.item, l.item)
    else into.item = cloneLevel(l.item)
  }
  if (l.pair) {
    if (into.pair) mergeLevel(into.pair, l.pair)
    else into.pair = cloneLevel(l.pair)
  }
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
      const p = s.dataPaths(
        e.root,
        e.segments.map((x) => ({ p: x.name! })),
      )
      // A several-source alias (`@let x = a ? b : c`) tests whichever it
      // holds — not each source — so it guards none of them.
      if (p.length === 1) out.push(p[0]!)
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
  // The page, and each fragment, reads what the snippets it renders read (and
  // what the snippets those render read — each once, recursion included).
  const reach = (called: Iterable<string>, into: Map<string, Level>) => {
    const seen = new Set<string>()
    const todo = [...called]
    while (todo.length) {
      const snippet = todo.pop()!
      if (seen.has(snippet)) continue
      seen.add(snippet)
      const reads = s.snippetReads.get(snippet)
      if (reads) mergeLevels(into, reads)
      for (const next of s.snippetCalls.get(snippet) ?? []) todo.push(next)
    }
  }
  reach(s.pageCalls, s.roots)
  for (const [name, called] of s.fragmentCalls) {
    const f = s.fragments.get(name)
    if (f) reach(called, f.reads)
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
    // Stricter wins: null is allowed only when both allow it.
    nullable: a.nullable && b.nullable,
  }
}

/** `from`'s fields merged into `into` (a layout's reads into its page's). */
export function mergeSummary(into: DataSummary, from: DataSummary): DataSummary {
  const fields = { ...into.fields }
  for (const [k, v] of Object.entries(from.fields)) fields[k] = fields[k] ? merge(fields[k]!, v) : v
  return {
    ...into,
    fields,
    declared: mergeDeclared(into.declared, from.declared),
    // Imports stay with the template that wrote them: typegen emits each
    // template's, resolved from that template's own folder.
  }
}

/**
 * A page's declarations over its layout's: the page's type wins, but a
 * layout default still makes the name optional (it fills it in).
 */
function mergeDeclared(
  page: DataSummary['declared'],
  layout: DataSummary['declared'],
): DataSummary['declared'] {
  const out = { ...layout }
  for (const [name, d] of Object.entries(page)) {
    const l = layout[name]
    if (!l) {
      out[name] = d
      continue
    }
    const type = d.type ?? l.type
    // A layout default of another type isn't what the page declared: no help.
    const fits = !d.type || !l.type || d.type === l.type
    out[name] = { ...(type ? { type } : {}), optional: d.optional || (l.optional && fits) }
  }
  return out
}
