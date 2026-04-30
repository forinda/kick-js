import type { Change, ChangeSet } from './types'

/**
 * Reverse a forward ChangeSet so emitting it produces the SQL that undoes
 * the forward migration.
 *
 * The reverse of an *unambiguous* change is exact (rename → rename swapped,
 * add → drop, drop → add). The reverse of an *ambiguous* change (drop column,
 * drop table, type widen, NOT NULL gain without default) is a defensible
 * best-effort derived from the snapshot the forward change carried — the
 * runner refuses to apply a non-reviewed migration in non-dev so the operator
 * always sees the draft before it touches a DB.
 *
 * The order is reversed too: drop FK before drop index before drop table is
 * the safe sequence for tearing down what create-FK / create-index / create-
 * table built up.
 */
export function invertChanges(forward: ChangeSet): ChangeSet {
  const reversed: Change[] = []
  for (const change of forward) {
    reversed.push(invert(change))
  }
  return reversed.toReversed()
}

function invert(change: Change): Change {
  switch (change.kind) {
    case 'createTable':
      return { kind: 'dropTable', table: change.table }
    case 'dropTable':
      return { kind: 'createTable', table: change.table }
    case 'renameTable':
      return { kind: 'renameTable', from: change.to, to: change.from }
    case 'addColumn':
      return { kind: 'dropColumn', table: change.table, column: change.column }
    case 'dropColumn':
      return { kind: 'addColumn', table: change.table, column: change.column }
    case 'renameColumn':
      return {
        kind: 'renameColumn',
        table: change.table,
        from: change.to,
        to: change.from,
      }
    case 'alterColumn':
      return {
        kind: 'alterColumn',
        table: change.table,
        column: change.column,
        before: change.after,
        after: change.before,
      }
    case 'addIndex':
      return { kind: 'dropIndex', table: change.table, index: change.index }
    case 'dropIndex':
      return { kind: 'addIndex', table: change.table, index: change.index }
    case 'addForeignKey':
      return { kind: 'dropForeignKey', table: change.table, fk: change.fk }
    case 'dropForeignKey':
      return { kind: 'addForeignKey', table: change.table, fk: change.fk }
    case 'createEnum':
      return { kind: 'dropEnum', enum: change.enum }
    case 'dropEnum':
      return { kind: 'createEnum', enum: change.enum }
    case 'addEnumValue':
      // PG can't ALTER TYPE … DROP VALUE without recreating the type +
      // touching every column that uses it. Down-migrations carry the
      // forward change verbatim; the operator gets a draft + a clear
      // signal that the down won't auto-revert.
      return change
    case 'removeEnumValue':
      // The forward direction of a value removal is itself an
      // advisory + manual operation; the reverse is symmetric. Carry
      // the change verbatim so the down draft surfaces the same
      // SQL-comment guidance, with `removed` listing the values that
      // would need to be re-added.
      return change
  }
}

/**
 * Returns the change kinds that produce ambiguous reverses — drop column,
 * drop table, type widen — so the generator can flag the down.sql as a draft
 * even if every individual statement is technically valid SQL.
 */
const AMBIGUOUS_REVERSE_KINDS = new Set<Change['kind']>([
  'dropTable',
  'dropColumn',
  'alterColumn',
  // PG enum value additions can't auto-reverse — drop-value isn't
  // supported without recreating the type. The down draft surfaces
  // the forward statement so the operator manually rewrites it.
  'addEnumValue',
  // Removed values can't auto-reverse for the symmetric reason: the
  // value(s) that disappeared from the schema may have been held by
  // existing rows whose state is already gone. Down draft preserves
  // the advisory comment.
  'removeEnumValue',
])

export function hasAmbiguousReverse(forward: ChangeSet): boolean {
  return forward.some((c) => AMBIGUOUS_REVERSE_KINDS.has(c.kind))
}
