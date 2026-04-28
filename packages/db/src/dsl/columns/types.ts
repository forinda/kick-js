import type { ColumnSnapshot, FkAction } from '../../snapshot/types'

/**
 * Runtime + type representation of a column reference (e.g. `users.id`).
 * Carries the parent table name, the column's own name, plus runtime
 * accessors used by FK thunks and constraint builders.
 *
 * Exported so adopters can annotate self-referencing thunks without
 * spelling the shape inline:
 *
 *   parentId: uuid().references((): ColumnRef => categories.id)
 *
 * Without the annotation the initializer of a self-referencing const
 * trips TS7022 — TS needs to infer the const while the initializer
 * already references it.
 */
export interface ColumnRef {
  __tableName: string
  __name: string
  __builder: ColumnBuilder
  __state: () => ReturnType<ColumnBuilder['__state']>
}

/**
 * Resolved FK spec — `table` / `column` are pulled by invoking `thunk()`
 * lazily. The thunk pattern lets self-referencing tables work:
 *
 *   const categories = table('categories', {
 *     id: uuid().primaryKey().defaultRandom(),
 *     parentId: uuid().references((): ColumnRef => categories.id),
 *   })
 *
 * If we resolved at `.references()` call time, `categories` would TDZ-fail
 * inside its own initializer. Storing the thunk and resolving on read
 * (extract / render / emit) defers until after the const binding lands.
 */
export interface FkSpec {
  thunk: () => ColumnRef
  onDelete: FkAction
  onUpdate: FkAction
}

export interface ColumnState {
  type: string
  nullable: boolean
  default: string | null
  primaryKey: boolean
  unique: boolean
  references: FkSpec | null
}

/**
 * Type-only brand attached to a column when it's auto-assigned by the
 * database (serial / bigserial / smallserial), has a runtime default
 * (`.default(...)`), or carries an expression default
 * (`uuid().defaultRandom()`, `timestamp().defaultNow()`). `SchemaToTypes<S>`
 * reads this marker and wraps the column type in Kysely's `Generated<T>` so
 * adopters can omit the column on insert.
 *
 * Runtime is a no-op — the symbol never reaches a value.
 */
export const KICK_GENERATED = Symbol.for('@forinda/kickjs-db/Generated')
export type GeneratedBrand = { readonly [KICK_GENERATED]?: true }

/**
 * Type-only brand attached to a column when `.notNull()` or `.primaryKey()`
 * is called. `SchemaToTypes<S>` reads this brand to decide whether the
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
 * `SchemaToTypes<S>` can pull them out per column.
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
    target: () => ColumnRef,
    opts: { onDelete?: FkAction; onUpdate?: FkAction } = {},
  ): this {
    // Store the thunk — do NOT invoke it here. Self-referencing tables
    // pass `() => self.id` whose binding does not exist yet.
    this.state.references = {
      thunk: target,
      onDelete: opts.onDelete ?? 'no_action',
      onUpdate: opts.onUpdate ?? 'no_action',
    }
    return this
  }

  /**
   * Mark the column as having a runtime / DB-assigned default. The
   * `GeneratedBrand` flows into `SchemaToTypes<S>` so the column wraps
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
