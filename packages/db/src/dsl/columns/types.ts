import type { ColumnSnapshot } from '../../snapshot/types'

export interface ColumnState {
  type: string
  nullable: boolean
  default: string | null
  primaryKey: boolean
  unique: boolean
  references: { table: string; column: string; onDelete: string; onUpdate: string } | null
}

/**
 * Type-only brand attached to a column when it's auto-assigned by the
 * database (serial / bigserial / smallserial), has a runtime default
 * (`.default(...)`), or carries an expression default (`uuid().defaultRandom()`,
 * `timestamp().defaultNow()`). `SchemaToKysely<S>` reads this marker and
 * wraps the column type in Kysely's `Generated<T>` so adopters can omit
 * the column on insert.
 *
 * Runtime is a no-op — the symbol never reaches a value.
 */
export const KICK_GENERATED = Symbol.for('@forinda/kickjs-db/Generated')
export type GeneratedBrand = { readonly [KICK_GENERATED]: true }

/**
 * Phantom-typed column builder. The `T` generic carries the column's TS
 * value type (number / string / Date / etc.) and `TNullable` carries the
 * nullable flag. Both are erased at runtime; they exist purely so
 * `SchemaToKysely<S>` can pull them out per column.
 *
 * The chain methods that affect the type (`notNull()`, `primaryKey()`,
 * `array()`) return widened/narrowed phantoms; everything else returns
 * `this` so the chain stays callable.
 */
export class ColumnBuilder<T = unknown, TNullable extends boolean = true> {
  // The phantom param `T` shows up in the public surface so the type system
  // sees it; reading it at runtime is intentionally not supported.
  declare readonly __t?: T
  declare readonly __nullable?: TNullable

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

  notNull(): ColumnBuilder<T, false> {
    this.state.nullable = false
    return this as unknown as ColumnBuilder<T, false>
  }

  primaryKey(): ColumnBuilder<T, false> {
    this.state.primaryKey = true
    this.state.nullable = false
    return this as unknown as ColumnBuilder<T, false>
  }

  unique(): this {
    this.state.unique = true
    return this
  }

  array(): ColumnBuilder<T[], TNullable> {
    this.state.type = `${this.state.type}[]`
    return this as unknown as ColumnBuilder<T[], TNullable>
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

  /**
   * Mark the column as having a runtime / DB-assigned default. The
   * `GeneratedBrand` flows into `SchemaToKysely<S>` so the column wraps
   * in `Generated<T>` — adopters can `INSERT` without specifying it.
   */
  default(value: string): this & GeneratedBrand {
    this.state.default = value
    return this as this & GeneratedBrand
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
