import { SafeNullComparisonPlugin, type KyselyPlugin } from 'kysely'

// M5.B.2 — Built-in plugin helpers surfaced on the kickjs-db root.
//
// The wrappers stay one-line passthroughs for now so adopter call
// sites match the Kysely upstream docs (`safeNullComparison()` reads
// the same as Kysely's own `new SafeNullComparisonPlugin()`), while
// any future plugin-specific kickjs option (e.g. opt-out per call,
// instrumentation hooks) has a place to land without breaking the
// adopter import surface.

/**
 * Returns Kysely's `SafeNullComparisonPlugin`. Pass it to
 * `createDbClient({ plugins: [...] })` so `eb('col', '=', null)`
 * (and `'!='`, `'<>'`) compiles to `IS NULL` / `IS NOT NULL`
 * instead of the silently-false `= NULL`.
 *
 * Without the plugin, Kysely passes `null` through as a bound
 * parameter — the resulting `col = $1` evaluates to UNKNOWN under
 * three-valued logic, which filters out every row including the
 * ones the adopter intended to match. The plugin rewrites the AST
 * before compilation so the operator becomes `IS` / `IS NOT` when
 * the right-hand side is literal `null`.
 *
 * ```ts
 * import { createDbClient, safeNullComparison } from '@forinda/kickjs-db'
 *
 * const db = createDbClient({
 *   schema,
 *   dialect: pgDialect({ pool }),
 *   plugins: [safeNullComparison()],
 * })
 *
 * await db.selectFrom('users').where('deletedAt', '=', null).selectAll().execute()
 * // → SQL: select * from "users" where "deletedAt" is null
 * ```
 *
 * Opt-in; default `createDbClient` chains stay byte-identical so
 * existing repos that already work around the gotcha manually
 * don't see a behaviour change.
 */
export function safeNullComparison(): KyselyPlugin {
  return new SafeNullComparisonPlugin()
}
