/**
 * Qualified name for a table snapshot — `billing.invoices` when the table
 * declares a schema, the bare name otherwise.
 *
 * This is the form used as the `SchemaSnapshot.tables` key and as every
 * `table: string` field on a diff `Change`, so anything holding a whole
 * `TableSnapshot` must run it through here before comparing against one of
 * those. `quoteIdent` splits on `.`, so the result also renders correctly as
 * an identifier without further work.
 */
export function snapshotTableName(t: { name: string; schema?: string }): string {
  return t.schema ? `${t.schema}.${t.name}` : t.name
}
