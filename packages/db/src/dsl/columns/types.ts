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
 * (`.default(...)`), or carries an expression default
 * (`uuid().defaultRandom()`, `timestamp().defaultNow()`). `SchemaToKysely<S>`
 * reads this marker and wraps the column type in Kysely's `Generated<T>` so
 * adopters can omit the column on insert.
 *
 * Runtime is a no-op — the symbol never reaches a value.
 */
export const KICK_GENERATED = Symbol.for('@forinda/kickjs-db/Generated')
export type GeneratedBrand = { readonly [KICK_GENERATED]?: true }

/**
 * Type-only brand attached to a column when `.notNull()` or `.primaryKey()`
 * is called. `SchemaToKysely<S>` reads this brand to decide whether the
 * column type is `T` (NOT NULL) or `T | null` (default nullable).
 *
 * Why a brand instead of a class generic: chained methods (notNull,
 * primaryKey) can return `this & NotNullBrand` to narrow nullability while
 * preserving the subclass identity — so `uuid().primaryKey().defaultRandom()`
 * still resolves `defaultRandom()` on `UuidBuilder`. A class generic
 * `<TNullable>` would collapse the subclass back to the parent.
 */
export const KICK_NOT_NULL = Symbol.for('@forinda/kickjs-db/NotNull')
export type NotNullBrand = { readonly [KICK_NOT_NULL]?: true }

/**
 * Phantom-typed column builder. The `T` generic carries the column's TS
 * value type (number / string / Date / etc.); nullability is tracked via
 * the `NotNullBrand` intersection rather than a class generic so chain
 * methods preserve subclass identity.
 *
 * Both `T` and the brand are erased at runtime; they exist purely so
 * `SchemaToKysely<S>` can pull them out per column.
 */
export class ColumnBuilder<T = unknown> {
  // Phantom param shows up in the public surface so the type system sees
  // it. Reading it at runtime is intentionally not supported.
  declare readonly __t?: T

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

  notNull(): this & NotNullBrand {
    this.state.nullable = false
    return this as this & NotNullBrand
  }

  primaryKey(): this & NotNullBrand {
    this.state.primaryKey = true
    this.state.nullable = false
    return this as this & NotNullBrand
  }

  unique(): this {
    this.state.unique = true
    return this
  }

  array(): ColumnBuilder<T[]> {
    this.state.type = `${this.state.type}[]`
    return this as unknown as ColumnBuilder<T[]>
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
