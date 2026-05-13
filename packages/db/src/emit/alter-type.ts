import { quoteIdent, quoteLiteral } from './identifiers'

// M5.B.1 — Typed IR for the four PG `ALTER TYPE` shapes that the
// migration emitter produces. Modelled on Kysely 0.29's
// `AlterTypeNode` (operation-node/alter-type-node.d.ts) so the
// shapes stay in sync with the upstream typed surface, but rendered
// by the local emitter — Kysely's `PostgresQueryCompiler` emits
// lowercase keywords (`alter type "foo" rename to ...`) while the
// kickjs-db emitter has always emitted uppercase. The existing
// snapshot tests + every adopter's `_journal.json` migration hash
// lock the uppercase form, so byte-identical output is the
// constraint; Kysely's compiler can't honor it.
//
// Refactor goal: consolidate the four `ALTER TYPE` string-builds
// scattered through `emit/pg.ts` into one typed IR + one renderer,
// so future enum-related work (rename, value-rename, schema-move)
// touches one source of truth instead of N call sites.

/** Pure data describing one PG `ALTER TYPE` statement. */
export type AlterTypeIr = AlterTypeRenameTo | AlterTypeAddValue | AlterTypeRenameValue

export interface AlterTypeRenameTo {
  readonly kind: 'renameTo'
  readonly name: string
  readonly newName: string
}

export interface AlterTypeAddValue {
  readonly kind: 'addValue'
  readonly name: string
  readonly value: string
  /**
   * Optional positional clause. Mutually exclusive with `after`;
   * the renderer rejects both being set.
   */
  readonly before?: string
  readonly after?: string
}

export interface AlterTypeRenameValue {
  readonly kind: 'renameValue'
  readonly name: string
  readonly oldValue: string
  readonly newValue: string
}

/** Build a `RENAME TO` IR node. */
export function alterTypeRenameTo(name: string, newName: string): AlterTypeRenameTo {
  return { kind: 'renameTo', name, newName }
}

/** Build an `ADD VALUE` IR node. Pass at most one of `before` / `after`. */
export function alterTypeAddValue(
  name: string,
  value: string,
  position?: { before?: string; after?: string },
): AlterTypeAddValue {
  return {
    kind: 'addValue',
    name,
    value,
    before: position?.before,
    after: position?.after,
  }
}

/** Build a `RENAME VALUE` IR node. */
export function alterTypeRenameValue(
  name: string,
  oldValue: string,
  newValue: string,
): AlterTypeRenameValue {
  return { kind: 'renameValue', name, oldValue, newValue }
}

/**
 * Render an `AlterTypeIr` to a single trailing-`;` SQL statement
 * matching the historic emitter output byte-for-byte. Identifiers
 * pass through `quoteIdent`; values through `quoteLiteral`.
 */
export function renderAlterType(ir: AlterTypeIr): string {
  switch (ir.kind) {
    case 'renameTo':
      return `ALTER TYPE ${quoteIdent(ir.name)} RENAME TO ${quoteIdent(ir.newName)};`
    case 'addValue': {
      if (ir.before != null && ir.after != null) {
        throw new Error(
          'alterTypeAddValue: `before` and `after` are mutually exclusive — pass at most one',
        )
      }
      const position =
        ir.before != null
          ? ` BEFORE ${quoteLiteral(ir.before)}`
          : ir.after != null
            ? ` AFTER ${quoteLiteral(ir.after)}`
            : ''
      return `ALTER TYPE ${quoteIdent(ir.name)} ADD VALUE ${quoteLiteral(ir.value)}${position};`
    }
    case 'renameValue':
      return (
        `ALTER TYPE ${quoteIdent(ir.name)} ` +
        `RENAME VALUE ${quoteLiteral(ir.oldValue)} TO ${quoteLiteral(ir.newValue)};`
      )
  }
}
