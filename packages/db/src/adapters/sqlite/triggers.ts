/**
 * Triggers through a SQLite table rebuild. A rebuild drops the old table, and
 * its triggers with it; kick/db doesn't track triggers in the schema, so the
 * adapters read them before the migration and create them again after it.
 */

export interface TriggerRow {
  name: string
  tbl_name: string
  sql: string
}

/** Reads a table's triggers: `?` placeholders, one per rebuilt table. */
export function triggersQuery(tables: readonly string[]): string {
  return `SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN (${tables.map(() => '?').join(', ')})`
}

/** A rebuilt table's columns, from the migration's own `CREATE TABLE "_kick_new_<table>"`. */
function rebuiltColumns(sql: string, table: string): Set<string> | undefined {
  const quoted = `"_kick_new_${table.replace(/"/g, '""')}"`
  const start = sql.indexOf(`CREATE TABLE ${quoted} (`)
  if (start === -1) return undefined
  const body = sql.slice(start, sql.indexOf('\n);', start))
  // SQLite matches column names without regard to ASCII case.
  return new Set(
    [...body.matchAll(/^\s+"((?:[^"]|"")+)"/gm)].map((m) =>
      m[1]!.replace(/""/g, '"').toLowerCase(),
    ),
  )
}

/**
 * Refuse a trigger that uses `new.x` / `old.x` for a column the rebuilt table
 * no longer has: SQLite would create it, then fail on every write that fires it.
 */
export function checkTriggers(triggers: readonly TriggerRow[], sql: string): void {
  for (const t of triggers) {
    const columns = rebuiltColumns(sql, t.tbl_name)
    if (!columns) continue
    // String literals and comments aren't code: `'new.removed'` in a message is text.
    const code = t.sql.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    for (const m of code.matchAll(/\b(?:new|old)\.(?:"((?:[^"]|"")+)"|(\w+))/gi)) {
      const column = m[1]?.replace(/""/g, '"') ?? m[2]!
      if (!columns.has(column.toLowerCase())) {
        throw new Error(
          `kickjs-db: trigger ${t.name} on ${t.tbl_name} uses ${column}, which this migration's rebuild of ${t.tbl_name} no longer has — drop or rewrite the trigger, then migrate`,
        )
      }
    }
  }
}
