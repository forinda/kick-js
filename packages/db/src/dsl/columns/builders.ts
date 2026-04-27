import { ColumnBuilder } from './types'

export function serial(): ColumnBuilder {
  return new ColumnBuilder('serial', { nullable: false })
}

export function integer(): ColumnBuilder {
  return new ColumnBuilder('integer')
}

export function varchar(length = 255): ColumnBuilder {
  return new ColumnBuilder(`varchar(${length})`)
}

export function text(): ColumnBuilder {
  return new ColumnBuilder('text')
}

export function boolean(): ColumnBuilder {
  return new ColumnBuilder('boolean')
}

export class TimestampBuilder extends ColumnBuilder {
  constructor() {
    super('timestamp')
  }

  defaultNow(): this {
    this.state.default = 'CURRENT_TIMESTAMP'
    return this
  }
}

export function timestamp(): TimestampBuilder {
  return new TimestampBuilder()
}
