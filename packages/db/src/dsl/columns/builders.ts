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
  constructor(typeName: string = 'timestamp') {
    super(typeName)
  }

  defaultNow(): this {
    this.state.default = 'CURRENT_TIMESTAMP'
    return this
  }
}

export function timestamp(): TimestampBuilder {
  return new TimestampBuilder('timestamp')
}

export function timestamptz(): TimestampBuilder {
  return new TimestampBuilder('timestamptz')
}

export function char(length = 1): ColumnBuilder {
  return new ColumnBuilder(`char(${length})`)
}

export function date(): ColumnBuilder {
  return new ColumnBuilder('date')
}

export function time(): ColumnBuilder {
  return new ColumnBuilder('time')
}

export function interval(): ColumnBuilder {
  return new ColumnBuilder('interval')
}

export class UuidBuilder extends ColumnBuilder {
  constructor() {
    super('uuid')
  }

  defaultRandom(): this {
    this.state.default = 'gen_random_uuid()'
    return this
  }
}

export function uuid(): UuidBuilder {
  return new UuidBuilder()
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
