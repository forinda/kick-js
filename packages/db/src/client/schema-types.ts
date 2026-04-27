import type { ColumnBuilder } from '../dsl/columns/types'
import type { TableDecl } from '../dsl/table'

/**
 * M1-permissive mapping: every column is `unknown`. M2-S1 tightens this with
 * proper type inference via phantom generics on column builders. Keeping it
 * loose here unblocks the rest of M1 — adopters can still cast at the call
 * site if they need precise types pre-M2.
 */
export type SchemaToKysely<S> = {
  [K in keyof S as S[K] extends TableDecl<Record<string, ColumnBuilder>>
    ? S[K]['__name']
    : never]: S[K] extends TableDecl<infer C> ? { [Col in keyof C]: unknown } : never
}
