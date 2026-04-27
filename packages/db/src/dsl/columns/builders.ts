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

export function bigSerial(): ColumnBuilder {
  return new ColumnBuilder('bigserial', { nullable: false })
}

export function bigint(): ColumnBuilder {
  return new ColumnBuilder('bigint')
}

export function smallint(): ColumnBuilder {
  return new ColumnBuilder('smallint')
}

export function decimal(precision?: number, scale?: number): ColumnBuilder {
  return new ColumnBuilder(formatNumeric('decimal', precision, scale))
}

export function numeric(precision?: number, scale?: number): ColumnBuilder {
  return new ColumnBuilder(formatNumeric('numeric', precision, scale))
}

export function real(): ColumnBuilder {
  return new ColumnBuilder('real')
}

export function doublePrecision(): ColumnBuilder {
  return new ColumnBuilder('double precision')
}

function formatNumeric(base: string, precision?: number, scale?: number): string {
  if (precision === undefined) return base
  if (scale === undefined) return `${base}(${precision})`
  return `${base}(${precision}, ${scale})`
}
