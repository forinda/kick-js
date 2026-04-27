import { ColumnBuilder } from './types'

export function tsvector(): ColumnBuilder {
  return new ColumnBuilder('tsvector')
}

export function vector(dim?: number): ColumnBuilder {
  return new ColumnBuilder(dim === undefined ? 'vector' : `vector(${dim})`)
}

export function citext(): ColumnBuilder {
  return new ColumnBuilder('citext')
}

export function money(): ColumnBuilder {
  return new ColumnBuilder('money')
}

export function inet(): ColumnBuilder {
  return new ColumnBuilder('inet')
}

export function cidr(): ColumnBuilder {
  return new ColumnBuilder('cidr')
}

export function xml(): ColumnBuilder {
  return new ColumnBuilder('xml')
}
