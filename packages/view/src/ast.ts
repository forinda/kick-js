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
  inputs: InputDecl[]
  body: Node[]
}
