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
