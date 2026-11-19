import type { Span } from './diagnostics'

/** Bumped when the shape of a checked template changes; builds and runtimes must agree. */
export const AST_FORMAT_VERSION = 2

/** A literal value in a template expression. */
export type Literal = string | number | boolean | null

/** One step of a path expression: `.name`, `[expr]`, or their `?.` forms. */
export interface PathSegment {
  /** `.name` / `?.name` */
  name?: string
  /** `[expr]` / `?.[expr]` */
  computed?: Expr
  optional: boolean
}

/** A parsed template expression. */
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

/** Where an interpolation lands, which decides how its value is escaped. */
export type Ctx = 'text' | 'rcdata' | 'raw-text' | 'comment'

/** A parsed element attribute. */
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

/** A parsed HTML element. */
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

/** One branch of an `@if` / `@else if` / `@else` chain. */
export interface IfBranch {
  /** Absent on `@else`. */
  cond?: Expr
  /** `@if (x; as y)` */
  alias?: string
  body: Node[]
}

/** A loop variable an `@for` can bind with `let`. */
export type LoopVar = '$index' | '$first' | '$last' | '$even' | '$odd' | '$count'

/** A parsed template node. */
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
  /** `@fragment('name') { }`: a block a render can ask for on its own */
  | { k: 'fragment'; name: string; body: Node[]; span: Span }
  /** `@push('name') { }`: content for a layout's `<stack name>` */
  | { k: 'push'; name: string; body: Node[]; span: Span }
  /** `<stack name="…" />`: where pushed content goes; `children` must be blank (checked) */
  | { k: 'stack'; name: string; children: Node[]; span: Span }

/** An `@input` declaration, with its default when given. */
export interface InputDecl {
  name: string
  default?: { value: Literal; span: Span }
  span: Span
}

/** A parsed template: its layout, inputs and body. */
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

/** A checked expression, as the renderer reads it. */
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

/** A checked template node, as the renderer walks it. */
export type CNode =
  /** static output */
  | { k: 's'; t: string }
  /** `{{ e }}`: `text` escapes HTML (trusted HTML prints as is), `rcdata` (`<title>`, `<textarea>`) escapes everything, `json` is the one value of a JSON script */
  | { k: 'i'; c: 'text' | 'rcdata' | 'json' | 'css'; e: CExpr; at: At }
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
      /** inputs of wrapped components further down the chain, by name */
      ci?: Array<{ n: string; e: CExpr }>
      fa: CAttr[]
      f: Record<string, CNode[]>
      /** this call is its template's root: it takes the caller's chained attributes */
      r?: 1
      at: At
    }
  /** `<slot name="n">fallback</slot>` */
  | { k: 'o'; n: string; fb: CNode[] }
  /** `@push('n') { }`: rendered, then added to stack `n` */
  | { k: 'push'; n: string; b: CNode[] }
  /** `<stack name="n" />`: filled once the render is done */
  | { k: 'stk'; n: string }
  | { k: 'as'; en: string }

/** A template after `check`: plain JSON the renderer walks, which a build can ship as data. */
/** A page's `@fragment`, compiled to render on its own. */
export interface CheckedFragment {
  /** names enclosing blocks bound (loop items, aliases, `@let`): the caller passes them */
  needs: string[]
  /** scope slots the unit needs */
  slots: number
  body: CNode[]
  /** a field in it has `validate` */
  validates?: true
}

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
  /** a component's `<script client>`: TypeScript as written (`js: false`), or plain JS once a build stripped it */
  client?: { code: string; js: boolean }
  /** a field in it has `validate`: pages rendering it ship the validator script */
  validates?: true
  /** its `@fragment`s, by name */
  fragments?: Record<string, CheckedFragment>
}
