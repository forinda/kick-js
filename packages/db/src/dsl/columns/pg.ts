import { ColumnBuilder } from './types'

// PG-only column types. Phantom T per builder so SchemaToKysely<S> can narrow
// each column to a useful TS shape — strings for the text-y types, number[]
// for vector embeddings, etc.

export function tsvector(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('tsvector')
}

export function vector(dim?: number): ColumnBuilder<number[]> {
  return new ColumnBuilder<number[]>(dim === undefined ? 'vector' : `vector(${dim})`)
}

export function citext(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('citext')
}

export function money(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('money')
}

export function inet(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('inet')
}

export function cidr(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('cidr')
}

export function xml(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('xml')
}
