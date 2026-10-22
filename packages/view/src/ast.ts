import type { Span } from './diagnostics'

/** Bumped when the shape of a checked template changes; builds and runtimes must agree. */
export const AST_FORMAT_VERSION = 1

export type Literal = string | number | boolean | null

export interface PathSegment {
  /** `.name` / `?.name` */
  name?: string
  /** `[expr]` / `?.[expr]` */
  computed?: Expr
  optional: boolean
}

export type Expr =
  | { kind: 'literal'; value: Literal; span: Span }
  | { kind: 'path'; root: string; segments: PathSegment[]; span: Span }
  | { kind: 'unary'; op: '!' | '-'; arg: Expr; span: Span }
  | {
      kind: 'binary'
      op: '+' | '-' | '<' | '>' | '<=' | '>=' | '==' | '!=' | '===' | '!=='
      left: Expr
      right: Expr
      span: Span
    }
  | { kind: 'logical'; op: '&&' | '||' | '??'; left: Expr; right: Expr; span: Span }
  | { kind: 'conditional'; test: Expr; whenTrue: Expr; whenFalse: Expr; span: Span }
  | { kind: 'pipe'; input: Expr; name: string; args: Expr[]; span: Span }

/** Where an interpolation lands, which decides how its value is escaped (spec §4). */
export type Ctx = 'text' | 'rcdata' | 'raw-text' | 'comment'

export interface Attr {
  /** As written: `href`, `userId` (from `[userId]`), `on` (from `[class.on]`). */
  name: string
  /**
   * `static` `a="x"`, `interp` `a="x{{ y }}"`, `bare` `a`, `bind` `[a]="expr"`,
   * `class` `[class.a]="expr"`, `style` `[style.a(.unit)]="expr"`.
   */
  kind: 'static' | 'interp' | 'bare' | 'bind' | 'class' | 'style'
  /** `static` / `interp`: the value, literal text and expressions in order. */
  parts?: Array<string | Expr>
  /** `bind` / `class` / `style`: the bound expression. */
  expr?: Expr
  /** `[style.width.px]`: `px`. */
  unit?: string
  quoted: boolean
  span: Span
}

export interface Element {
  k: 'element'
  /** As written. */
  tag: string
  attrs: Attr[]
  children: Node[]
  /** Inside `<svg>` / `<math>`: names keep their case. */
  foreign: boolean
  void: boolean
  selfClosing: boolean
  span: Span
}

export interface IfBranch {
  /** Absent on `@else`. */
  cond?: Expr
  /** `@if (x; as y)` */
  alias?: string
  body: Node[]
}

export type LoopVar = '$index' | '$first' | '$last' | '$even' | '$odd' | '$count'

export type Node =
  | { k: 'text'; value: string; span: Span }
  | { k: 'interp'; expr: Expr; ctx: Ctx; span: Span }
  | Element
  | { k: 'comment'; children: Node[]; span: Span }
  | { k: 'if'; branches: IfBranch[]; span: Span }
  | {
      k: 'for'
      item: string | [string, string]
      of: Expr
      lets: Record<string, LoopVar>
      body: Node[]
      empty?: Node[]
      span: Span
    }
  | {
      k: 'switch'
      on: Expr
      cases: Array<{ value: Expr; body: Node[] }>
      default?: Node[]
      span: Span
    }
  | { k: 'let'; name: string; expr: Expr; span: Span }
  | { k: 'verbatim'; text: string; span: Span }
  | { k: 'slot-outlet'; name?: string; fallback: Node[]; span: Span }
  | { k: 'slot-fill'; name: string; body: Node[]; span: Span }
  | { k: 'assets'; entry: string; span: Span }

export interface InputDecl {
  name: string
  default?: { value: Literal; span: Span }
  span: Span
}

export interface TemplateAst {
  file: string
  /** `undefined`: none declared (the default layout applies); `null`: `@layout(none)`. */
  layout?: string | null
  layoutSpan?: Span
  inputs: InputDecl[]
  body: Node[]
}

/** `[line, column]` of a node in its template, for render errors. */
export type At = [number, number]

// ── Checked templates: what `check` produces and `render` walks. Plain JSON,
// so a build can ship them as data. Short keys keep edge bundles small.

/** A path segment: `.n` or `[e]`; `o` marks `?.`. */
export type CSeg = { n: string; o?: 1 } | { e: CExpr; o?: 1 }

export type CExpr =
  /** literal */
  | { k: 'l'; v: Literal }
  /** undefined (a name a component doesn't have) */
  | { k: 'x' }
  /** page / shared data: `n` then the path */
  | { k: 'd'; n: string; p: CSeg[] }
  /** a scope slot (@let, loop item, @if alias, component input) then the path */
  | { k: 'v'; s: number; p: CSeg[] }
  /** a loop variable of the loop whose meta is in slot `s` */
  | { k: 'm'; s: number; w: LoopVar }
  | { k: 'u'; o: '!' | '-'; a: CExpr }
  | { k: 'b'; o: string; l: CExpr; r: CExpr }
  | { k: 'c'; t: CExpr; y: CExpr; n: CExpr }
  | { k: 'p'; n: string; i: CExpr; a: CExpr[] }

/** One attribute of an element whose attributes need work at render time. */
export type CAttr =
  /** static; `v: true` is a bare attribute */
  | { t: 's'; n: string; v: string | true }
  /** `n="text {{ e }}"`; `u` marks a URL attribute (`srcset` checks each candidate) */
  | { t: 'i'; n: string; p: Array<string | CExpr>; u?: 'url' | 'srcset' }
  /** `[n]="e"` */
  | { t: 'b'; n: string; e: CExpr; u?: 'url' | 'srcset' }
  /** `[class.n]="e"` */
  | { t: 'c'; n: string; e: CExpr }
  /** `[style.n(.x)]="e"` */
  | { t: 'y'; n: string; e: CExpr; x?: string }

export type CNode =
  /** static output */
  | { k: 's'; t: string }
  /** `{{ e }}`: `text` escapes HTML (trusted HTML prints as is), `rcdata` (`<title>`, `<textarea>`) escapes everything, `json` is the one value of a JSON script */
  | { k: 'i'; c: 'text' | 'rcdata' | 'json'; e: CExpr; at: At }
  /** the attributes of an element (between `<tag` and `>`); `f` takes a component caller's fallthrough attributes */
  | { k: 'A'; tag: string; a: CAttr[]; f?: 1; at: At }
  | { k: 'if'; br: Array<{ c?: CExpr; a?: number; b: CNode[] }> }
  | {
      k: 'for'
      e: CExpr
      it: number | [number, number]
      m: number
      b: CNode[]
      em?: CNode[]
      at: At
    }
  | { k: 'sw'; e: CExpr; cs: Array<{ e: CExpr; b: CNode[] }>; d?: CNode[] }
  | { k: 'let'; s: number; e: CExpr }
  /** a component: inputs into its slots, fallthrough attributes, slot fills (`''` is the default) */
  | {
      k: 'cmp'
      n: string
      in: Array<{ s: number; e: CExpr }>
      fa: CAttr[]
      f: Record<string, CNode[]>
      at: At
    }
  /** `<slot name="n">fallback</slot>` */
  | { k: 'o'; n: string; fb: CNode[] }
  | { k: 'as'; en: string }

export interface CheckedTemplate {
  v: typeof AST_FORMAT_VERSION
  name: string
  file: string
  /** declared layout; `null` is `@layout(none)`; absent means the default layout applies to a page */
  layout?: string | null
  /** scope slots the template needs */
  slots: number
  /** a component's inputs: name, slot, default, required */
  inputs: Array<{ n: string; s: number; d?: Literal; r: boolean }>
  /** `@slot('name') { }` fills a page passes to its layout */
  fills: Record<string, CNode[]>
  body: CNode[]
}
