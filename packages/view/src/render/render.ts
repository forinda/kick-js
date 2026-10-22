/**
 * The renderer: walks a checked template over the data and writes HTML.
 * Synchronous, no `eval` — every value goes through `read` and the escaper
 * for where it lands.
 */
import type { At, CAttr, CExpr, CNode, CheckedTemplate, CSeg, LoopVar } from '../ast'
import { error, type Diagnostic } from '../diagnostics'
import {
  SafeHtml,
  escapeHtml,
  escapeJsonForScript,
  read,
  safeStyleValue,
  sanitizeSrcset,
  sanitizeUrl,
} from './safe'
import { decodeEntities } from '../entities'

export type Pipe = (value: unknown, ...args: unknown[]) => unknown

export interface RenderEnv {
  locale: string
  timeZone: string
  strict: boolean
  pipes: Record<string, Pipe>
  warn(message: string): void
  /** A checked template by name: layouts and components. */
  resolve(name: string): CheckedTemplate
  /** The layout a page gets when it declares none (a folder mapping, usually). */
  layoutFor?(page: string): string | undefined
  /** The shell wrapped around every page's outermost layout. */
  baseLayout?: string
  /** `@assets('entry')`: the tags for a Vite entry; `data` is the page's (for a CSP nonce). */
  assets?(entry: string, data: Record<string, unknown>): string
}

export class RenderError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    const { file, span, message } = diagnostic
    super(`${file}:${span.start.line}:${span.start.column} — ${message}`)
    this.name = 'RenderError'
  }
}

/** The most components one render may nest — a self-including component stops here. */
export const MAX_DEPTH = 64

interface LoopMeta {
  i: number
  n: number
}

interface Resolved {
  attrs: Array<[string, string | true]>
  cls: string[]
  style: string[]
}

/** One template being rendered: its scope slots, data, slot fills and the template stack. */
interface Inst {
  t: CheckedTemplate
  data: Record<string, unknown>
  slots: unknown[]
  fills: Record<string, { nodes: CNode[]; inst: Inst }>
  fall?: Resolved
  stack: string[]
  depth: number
  /** The node being rendered, for error positions. */
  at?: At
}

const warnedNames = new WeakMap<CheckedTemplate, Set<string>>()

class Renderer {
  private readonly out: string[] = []

  constructor(private readonly env: RenderEnv) {}

  html(): string {
    return this.out.join('')
  }

  fail(inst: Inst, message: string): never {
    const [line, column] = inst.at ?? [1, 1]
    const pos = { offset: 0, line, column }
    const d = error(inst.t.file, { start: pos, end: pos }, message)
    d.stack = inst.stack
    throw new RenderError(d)
  }

  // ── values ────────────────────────────────────────────────────────────

  private path(value: unknown, p: CSeg[], inst: Inst): unknown {
    for (const seg of p) {
      if (value === null || value === undefined) return undefined
      value = read(value, 'n' in seg ? seg.n : this.value(seg.e, inst))
    }
    return value
  }

  value(e: CExpr, inst: Inst): unknown {
    switch (e.k) {
      case 'l':
        return e.v
      case 'x':
        return undefined
      case 'd': {
        if (!(e.n in inst.data)) this.unresolved(e.n, inst)
        return this.path(read(inst.data, e.n), e.p, inst)
      }
      case 'v':
        return this.path(inst.slots[e.s], e.p, inst)
      case 'm':
        return loopVar(inst.slots[e.s] as LoopMeta, e.w)
      case 'u': {
        const a = this.value(e.a, inst)
        return e.o === '!' ? !a : -(a as number)
      }
      case 'b': {
        if (e.o === '&&') return this.value(e.l, inst) && this.value(e.r, inst)
        if (e.o === '||') return this.value(e.l, inst) || this.value(e.r, inst)
        if (e.o === '??') return this.value(e.l, inst) ?? this.value(e.r, inst)
        const l = this.value(e.l, inst) as never
        const r = this.value(e.r, inst) as never
        switch (e.o) {
          case '==':
          case '===':
            return l === r
          case '!=':
          case '!==':
            return l !== r
          case '<':
            return l < r
          case '>':
            return l > r
          case '<=':
            return l <= r
          case '>=':
            return l >= r
          case '+':
            return (l as number) + (r as number)
          case '-':
            return (l as number) - (r as number)
        }
        return undefined
      }
      case 'c':
        return this.value(e.t, inst) ? this.value(e.y, inst) : this.value(e.n, inst)
      case 'p': {
        const pipe = this.env.pipes[e.n]
        if (!pipe) this.fail(inst, `unknown pipe '${e.n}'`)
        const input = this.value(e.i, inst)
        const args = e.a.map((a) => this.value(a, inst))
        let result: unknown
        try {
          result = pipe(input, ...args)
        } catch (err) {
          if (err instanceof RenderError) throw err
          this.fail(
            inst,
            `pipe '${e.n}' failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          this.fail(inst, `pipe '${e.n}' returned a Promise — pipes must be synchronous`)
        }
        return result
      }
    }
  }

  private unresolved(name: string, inst: Inst): void {
    if (this.env.strict) this.fail(inst, `'${name}' isn't in the data`)
    let seen = warnedNames.get(inst.t)
    if (!seen) warnedNames.set(inst.t, (seen = new Set()))
    if (seen.has(name)) return
    seen.add(name)
    this.env.warn(`${inst.t.file}: '${name}' isn't in the data passed to render`)
  }

  /** A value as text, unescaped; `undefined` when it has no text form. */
  private text(v: unknown, inst: Inst): string {
    if (v === null || v === undefined) return ''
    switch (typeof v) {
      case 'string':
        return v
      case 'number':
      case 'bigint':
      case 'boolean':
        return String(v)
    }
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString()
    if (v instanceof SafeHtml) return v.html
    const what =
      v && typeof (v as PromiseLike<unknown>).then === 'function'
        ? 'a Promise — await it in the controller'
        : Array.isArray(v)
          ? 'an array — loop over it with @for, or use | json'
          : 'an object — print one of its properties, or use | json'
    if (this.env.strict) this.fail(inst, `can't print ${what}`)
    this.env.warn(`${inst.t.file}:${inst.at?.[0] ?? 1}: can't print ${what}`)
    return ''
  }

  // ── nodes ─────────────────────────────────────────────────────────────

  nodes(list: CNode[], inst: Inst): void {
    for (const n of list) this.node(n, inst)
  }

  private node(n: CNode, inst: Inst): void {
    switch (n.k) {
      case 's':
        this.out.push(n.t)
        return
      case 'i': {
        inst.at = n.at
        const v = this.value(n.e, inst)
        if (n.c === 'json') {
          this.out.push(
            escapeJsonForScript(typeof v === 'string' ? v : (JSON.stringify(v) ?? 'null')),
          )
        } else if (v instanceof SafeHtml && n.c === 'text') {
          // Trusted HTML prints as is in text — never in <title>/<textarea>,
          // where it could close the element.
          this.out.push(v.html)
        } else {
          this.out.push(escapeHtml(v instanceof SafeHtml ? v.html : this.text(v, inst)))
        }
        return
      }
      case 'A':
        inst.at = n.at
        this.attrs(this.resolve(n.a, inst), n.f ? inst.fall : undefined)
        return
      case 'if':
        for (const br of n.br) {
          const v = br.c ? this.value(br.c, inst) : true
          if (!v) continue
          if (br.a !== undefined) inst.slots[br.a] = v
          this.nodes(br.b, inst)
          return
        }
        return
      case 'for': {
        inst.at = n.at
        const items = this.iterable(this.value(n.e, inst), inst)
        if (!items.length) {
          if (n.em) this.nodes(n.em, inst)
          return
        }
        const meta: LoopMeta = { i: 0, n: items.length }
        inst.slots[n.m] = meta
        for (let i = 0; i < items.length; i++) {
          meta.i = i
          const item = items[i]
          if (typeof n.it === 'number') inst.slots[n.it] = item
          else {
            inst.slots[n.it[0]] = (item as unknown[] | undefined)?.[0]
            inst.slots[n.it[1]] = (item as unknown[] | undefined)?.[1]
          }
          this.nodes(n.b, inst)
        }
        return
      }
      case 'sw': {
        const v = this.value(n.e, inst)
        const hit = n.cs.find((c) => this.value(c.e, inst) === v)
        if (hit) this.nodes(hit.b, inst)
        else if (n.d) this.nodes(n.d, inst)
        return
      }
      case 'let':
        inst.slots[n.s] = this.value(n.e, inst)
        return
      case 'cmp':
        inst.at = n.at
        this.component(n, inst)
        return
      case 'o': {
        const fill = inst.fills[n.n]
        if (fill) this.nodes(fill.nodes, fill.inst)
        else this.nodes(n.fb, inst)
        return
      }
      case 'as':
        if (this.env.assets) this.out.push(this.env.assets(n.en, inst.data))
        else
          this.env.warn(
            `${inst.t.file}: @assets('${n.en}') needs the Vite plugin or an assets option`,
          )
    }
  }

  private iterable(v: unknown, inst: Inst): unknown[] {
    if (v === null || v === undefined) return []
    if (Array.isArray(v)) return v
    if (typeof v === 'string') return [...v]
    if (v instanceof Map) return [...v.entries()]
    if (v instanceof Set) return [...v]
    this.fail(
      inst,
      `@for can't loop over ${typeof v === 'object' ? 'an object — use | entries' : `a ${typeof v}`}`,
    )
  }

  // ── attributes ────────────────────────────────────────────────────────

  /** A value for an attribute: text form, HTML-escaped. */
  private attrValue(v: unknown, inst: Inst): string {
    return escapeHtml(this.plain(v, inst))
  }

  /** A value's text, unescaped (trusted HTML as its source). */
  private plain(v: unknown, inst: Inst): string {
    return v instanceof SafeHtml ? v.html : this.text(v, inst)
  }

  /**
   * Values in `Resolved` are ready to write between double quotes: the
   * author's static text as written (entities kept), interpolated values
   * escaped once.
   */
  resolve(list: CAttr[], inst: Inst): Resolved {
    const r: Resolved = { attrs: [], cls: [], style: [] }
    const put = (name: string, value: string | true) => {
      const lower = name.toLowerCase()
      if (lower === 'class') {
        if (value !== true && value.trim()) r.cls.push(value.trim())
      } else if (lower === 'style') {
        if (value !== true && value.trim()) r.style.push(value.trim().replace(/;\s*$/, ''))
      } else {
        r.attrs.push([name, value])
      }
    }
    for (const a of list) {
      switch (a.t) {
        case 's':
          put(a.n, a.v === true ? true : a.v.replace(/"/g, '&quot;'))
          break
        case 'i': {
          const values = a.p.map((p) => (typeof p === 'string' ? undefined : this.value(p, inst)))
          const html = a.p
            .map((p, i) =>
              typeof p === 'string' ? p.replace(/"/g, '&quot;') : this.attrValue(values[i], inst),
            )
            .join('')
          if (!a.u) {
            put(a.n, html)
            break
          }
          // The scheme check reads what the browser will: the whole value as
          // written out, entities decoded — so a reference left unfinished in
          // static text (`&#10`) and completed by a value is read as one.
          const plain = decodeEntities(html)
          const safe = a.u === 'url' ? sanitizeUrl(plain) : sanitizeSrcset(plain)
          put(a.n, safe === plain ? html : escapeHtml(safe))
          break
        }
        case 'b': {
          const v = this.value(a.e, inst)
          if (v === null || v === undefined || v === false) break
          if (v === true) {
            put(a.n, true)
            break
          }
          const plain = this.plain(v, inst)
          put(
            a.n,
            escapeHtml(
              a.u === 'url' ? sanitizeUrl(plain) : a.u === 'srcset' ? sanitizeSrcset(plain) : plain,
            ),
          )
          break
        }
        case 'c':
          if (this.value(a.e, inst)) r.cls.push(escapeHtml(a.n))
          break
        case 'y': {
          const v = this.value(a.e, inst)
          if (v === null || v === undefined || v === false) break
          const value = safeStyleValue(`${this.text(v, inst)}${a.x ?? ''}`)
          if (value === undefined) {
            this.env.warn(
              `${inst.t.file}:${inst.at?.[0] ?? 1}: dropped an unsafe value for [style.${a.n}]`,
            )
            break
          }
          r.style.push(`${escapeHtml(a.n)}:${escapeHtml(value)}`)
          break
        }
      }
    }
    return r
  }

  private attrs(own: Resolved, fall?: Resolved): void {
    let attrs = own.attrs
    let cls = own.cls
    let style = own.style
    if (fall) {
      // The caller's attributes win over the root's own, except class and
      // style, which merge.
      const names = new Set(fall.attrs.map(([n]) => n.toLowerCase()))
      attrs = [...attrs.filter(([n]) => !names.has(n.toLowerCase())), ...fall.attrs]
      cls = [...cls, ...fall.cls]
      style = [...style, ...fall.style]
    }
    for (const [n, v] of attrs) this.out.push(v === true ? ` ${n}` : ` ${n}="${v}"`)
    if (cls.length) this.out.push(` class="${cls.join(' ')}"`)
    if (style.length) this.out.push(` style="${style.join(';')}"`)
  }

  // ── components and layouts ────────────────────────────────────────────

  private component(n: Extract<CNode, { k: 'cmp' }>, caller: Inst): void {
    if (caller.depth >= MAX_DEPTH) {
      this.fail(caller, `components nest more than ${MAX_DEPTH} deep — is ${n.n} including itself?`)
    }
    const t = this.env.resolve(n.n)
    const slots: unknown[] = Array.from({ length: t.slots })
    for (const i of t.inputs) if (i.d !== undefined) slots[i.s] = i.d
    for (const i of n.in) slots[i.s] = this.value(i.e, caller)
    const fills: Inst['fills'] = {}
    for (const [name, nodes] of Object.entries(n.f)) fills[name] = { nodes, inst: caller }
    const inst: Inst = {
      t,
      data: Object.create(null),
      slots,
      fills,
      fall: this.resolve(n.fa, caller),
      stack: [...caller.stack, n.n],
      depth: caller.depth + 1,
    }
    this.nodes(t.body, inst)
  }
}

function loopVar(m: LoopMeta, w: LoopVar): unknown {
  switch (w) {
    case '$index':
      return m.i
    case '$first':
      return m.i === 0
    case '$last':
      return m.i === m.n - 1
    case '$even':
      return m.i % 2 === 0
    case '$odd':
      return m.i % 2 === 1
    case '$count':
      return m.n
  }
}

/**
 * Render a checked page with `data`. Its layouts wrap it, outermost last:
 * `opts.layout` (a name, or `false` for none), else the page's `@layout`, else
 * the environment's mapping — then the base layout around the outermost one.
 * `@layout(none)` and `layout: false` skip the base too.
 */
export function render(
  template: CheckedTemplate,
  data: object,
  env: RenderEnv,
  opts: { layout?: boolean | string } = {},
): string {
  const r = new Renderer(env)
  const page: Inst = {
    t: template,
    data: data as Record<string, unknown>,
    slots: Array.from({ length: template.slots }),
    fills: {},
    stack: [template.name],
    depth: 0,
  }
  const none = opts.layout === false || (opts.layout === undefined && template.layout === null)
  const chain: CheckedTemplate[] = []
  if (!none) {
    let next =
      typeof opts.layout === 'string'
        ? opts.layout
        : (template.layout ?? env.layoutFor?.(template.name))
    while (next && next !== template.name && !chain.some((t) => t.name === next)) {
      const t = env.resolve(next)
      chain.push(t)
      next = t.layout ?? undefined
    }
    const base = env.baseLayout
    if (base && base !== template.name && !chain.some((t) => t.name === base))
      chain.push(env.resolve(base))
  }
  if (!chain.length) {
    r.nodes(template.body, page)
    return r.html()
  }
  // Each layout renders the one inside it into its default slot; named fills
  // pass outward until a layout's own fill replaces them.
  let fills: Inst['fills'] = { '': { nodes: template.body, inst: page } }
  for (const [name, nodes] of Object.entries(template.fills)) fills[name] = { nodes, inst: page }
  let inst: Inst = page
  for (const [i, t] of chain.entries()) {
    inst = {
      t,
      data: page.data,
      slots: Array.from({ length: t.slots }),
      fills,
      stack: [...inst.stack, t.name],
      depth: 0,
    }
    if (i === chain.length - 1) break
    const outer: Inst['fills'] = { ...fills, '': { nodes: t.body, inst } }
    for (const [name, nodes] of Object.entries(t.fills)) outer[name] = { nodes, inst }
    fills = outer
  }
  r.nodes(inst.t.body, inst)
  return r.html()
}
