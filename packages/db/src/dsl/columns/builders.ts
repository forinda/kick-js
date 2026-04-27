import { ColumnBuilder } from './types'

export function serial(): ColumnBuilder {
  return new ColumnBuilder('serial', { nullable: false })
}

export function integer(): ColumnBuilder {
  return new ColumnBuilder('integer')
}
