import type { ColumnSnapshot } from '../../snapshot/types'

export interface ColumnState {
  type: string
  nullable: boolean
  default: string | null
  primaryKey: boolean
  unique: boolean
  references: { table: string; column: string; onDelete: string; onUpdate: string } | null
}

export class ColumnBuilder {
  protected state: ColumnState

  constructor(type: string, defaults: Partial<ColumnState> = {}) {
    this.state = {
      type,
      nullable: defaults.nullable ?? true,
      default: defaults.default ?? null,
      primaryKey: defaults.primaryKey ?? false,
      unique: defaults.unique ?? false,
      references: defaults.references ?? null,
    }
  }

  notNull(): this {
    this.state.nullable = false
    return this
  }

  default(value: string): this {
    this.state.default = value
    return this
  }

  primaryKey(): this {
    this.state.primaryKey = true
    this.state.nullable = false
    return this
  }

  unique(): this {
    this.state.unique = true
    return this
  }

  array(): this {
    this.state.type = `${this.state.type}[]`
    return this
  }

  references(
    target: () => { __tableName: string; __name: string },
    opts: { onDelete?: string; onUpdate?: string } = {},
  ): this {
    const ref = target()
    this.state.references = {
      table: ref.__tableName,
      column: ref.__name,
      onDelete: opts.onDelete ?? 'no_action',
      onUpdate: opts.onUpdate ?? 'no_action',
    }
    return this
  }

  toJSON(name: string): ColumnSnapshot {
    return {
      name,
      type: this.state.type,
      nullable: this.state.nullable,
      default: this.state.default,
      primaryKey: this.state.primaryKey,
    }
  }

  // Internal accessor for table()/diff to read full state including unique/references.
  __state(): Readonly<ColumnState> {
    return this.state
  }
}
