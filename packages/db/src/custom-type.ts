// customType<T>() — adopter-defined column type with optional driver
// codecs. Lets a project introduce a typed column that doesn't ship
// in the built-in DSL (encrypted strings, custom JSON shapes, citext,
// PostGIS geometry, etc.) without forking the package.
//
// Schema usage:
//
//   const encrypted = customType<EncryptedString>({
//     dataType: () => 'text',
//     toDriver: (s) => encrypt(s),
//     fromDriver: (raw) => decrypt(String(raw)),
//   })
//
//   export const secrets = table('secrets', {
//     id: serial().primaryKey(),
//     value: encrypted().notNull(),
//   })
//
// `SchemaToKysely<typeof schema>` reads the phantom T from the
// CustomColumnBuilder so `db.selectFrom('secrets').select('value')`
// types `value: EncryptedString` (not `string`). Driver codecs flow
// through the lifecycle plugin landing in M2.F-T19; until then they
// are stored on the builder for the runtime hookup to pick up.

import { ColumnBuilder } from './dsl/columns/types'

export interface CustomTypeOptions<TJs, TDriver = unknown> {
  /**
   * SQL data type as it would appear in `CREATE TABLE` — `'text'`,
   * `'jsonb'`, `'citext'`, `'geometry(Point, 4326)'`, etc. Returned
   * via a thunk so adopters can compute the type from runtime config
   * (e.g. dialect-specific overrides).
   */
  dataType: () => string
  /** Optional encode hook applied at insert / update time. */
  toDriver?: (value: TJs) => TDriver
  /** Optional decode hook applied to selected rows. */
  fromDriver?: (driver: TDriver) => TJs
}

/**
 * ColumnBuilder subclass produced by `customType()`. Carries the
 * driver codecs so the (future) hooks pipeline can wire them through
 * a Kysely plugin without each consumer re-declaring its mapping.
 *
 * The phantom `T` flows through `SchemaToKysely<S>` exactly like any
 * other ColumnBuilder<T>, so adopters get full row-shape inference
 * for free.
 */
export class CustomColumnBuilder<TJs> extends ColumnBuilder<TJs> {
  /** Encode hook — run on values heading into the database. */
  readonly toDriver?: (value: TJs) => unknown
  /** Decode hook — run on row values coming out of the database. */
  readonly fromDriver?: (driver: unknown) => TJs

  constructor(opts: CustomTypeOptions<TJs>) {
    super(opts.dataType())
    this.toDriver = opts.toDriver as never
    this.fromDriver = opts.fromDriver as never
  }
}

/**
 * Build a reusable column factory for a custom type. The returned
 * function is what callers use inside `table('foo', { col: factory() })`
 * — same shape as the built-in `varchar()`, `text()`, etc.
 *
 * @example
 * ```ts
 * const ulid = customType<string>({
 *   dataType: () => 'char(26)',
 *   toDriver: (s) => s,
 *   fromDriver: (raw) => String(raw),
 * })
 *
 * const events = table('events', {
 *   id: ulid().primaryKey(),
 *   ts: timestamp().notNull().defaultNow(),
 * })
 * ```
 */
export function customType<TJs>(opts: CustomTypeOptions<TJs>): () => CustomColumnBuilder<TJs> {
  return () => new CustomColumnBuilder<TJs>(opts)
}
