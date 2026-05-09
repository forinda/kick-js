/**
 * PG composite-type detection for `removeEnumValue` migrations (M4.C).
 *
 * The M3.B rename-recreate dance assumes the enum is referenced only by
 * table columns — each affected column gets a single `ALTER TABLE …
 * ALTER COLUMN … TYPE foo USING column::text::foo` clause. PG composite
 * types / arrays-of-composite / domains containing the enum break that
 * approach: the USING clause can't reach into composite fields, so the
 * migration fails opaquely at apply time with `type X is being used by
 * table Y`.
 *
 * `detectCompositeReferences` queries `pg_type` + `pg_attribute` to
 * surface those references at generate time. The CLI `kick db generate`
 * command then refuses to emit a migration when any are found, telling
 * the operator to drop or restructure the composite first.
 *
 * Driver-agnostic: takes a structural query runner (any pg-protocol-
 * compatible client). The CLI wires this against the same pool used for
 * `kick db migrate` so adopters don't configure a second connection.
 *
 * Spec: docs/db/m4-plan.md §M4.C.
 */

import { KickDbError } from '../errors'

/**
 * One composite-type field that holds the target enum. The composite
 * may itself be referenced by table columns; that second level is not
 * surfaced — the goal here is to refuse the rename-recreate, not to
 * map the full dependency graph.
 */
export interface CompositeRef {
  /** Schema-qualified composite type name, e.g. `"public.address_t"`. */
  composite: string
  /** Attribute (field) within the composite that holds the enum. */
  attribute: string
  /** Schema-qualified enum type name. */
  enum: string
}

/**
 * Slim contract for a pg-protocol-compatible query function. Both
 * `pg.Pool` and `@neondatabase/serverless`'s Pool match this shape, as
 * does the `query` method on a pooled client.
 */
export interface CompositeQueryRunner {
  query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: R[] }>
}

interface CompositeRow {
  composite_schema: string
  composite_name: string
  attribute_name: string
  enum_schema: string
  enum_name: string
}

/**
 * Find every PG composite type whose attribute(s) hold the given enum
 * type. `enumName` may be unqualified (treated as `public.<name>`) or
 * schema-qualified (`schema.name`).
 *
 * Returns an empty array when:
 *  - the enum doesn't exist in the live DB (the diff engine raised it
 *    against a snapshot, but the DB hasn't applied the prior migration
 *    yet — generate-time refusal would be a false alarm), or
 *  - no composite references the enum (the M3.B path is safe).
 */
export async function detectCompositeReferences(
  runner: CompositeQueryRunner,
  enumName: string,
): Promise<CompositeRef[]> {
  const { schema, name } = splitQualifiedName(enumName)

  const sql = `
    SELECT
      ns_comp.nspname AS composite_schema,
      t_comp.typname AS composite_name,
      a.attname AS attribute_name,
      ns_enum.nspname AS enum_schema,
      t_enum.typname AS enum_name
    FROM pg_type t_comp
    JOIN pg_namespace ns_comp ON ns_comp.oid = t_comp.typnamespace
    JOIN pg_class c ON c.oid = t_comp.typrelid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_type t_enum_or_arr ON t_enum_or_arr.oid = a.atttypid
    JOIN pg_type t_enum ON t_enum.oid = COALESCE(NULLIF(t_enum_or_arr.typelem, 0), t_enum_or_arr.oid)
    JOIN pg_namespace ns_enum ON ns_enum.oid = t_enum.typnamespace
    WHERE t_comp.typtype = 'c'
      AND c.relkind = 'c'
      AND t_enum.typtype = 'e'
      AND t_enum.typname = $1
      AND ($2::text IS NULL OR ns_enum.nspname = $2)
  `

  const result = await runner.query<CompositeRow>(sql, [name, schema])
  return result.rows.map((r) => ({
    composite: `${r.composite_schema}.${r.composite_name}`,
    attribute: r.attribute_name,
    enum: `${r.enum_schema}.${r.enum_name}`,
  }))
}

function splitQualifiedName(qualified: string): { schema: string | null; name: string } {
  const dot = qualified.indexOf('.')
  if (dot === -1) return { schema: null, name: qualified }
  return { schema: qualified.slice(0, dot), name: qualified.slice(dot + 1) }
}

/**
 * Thrown by `kick db generate` when the diff would emit one or more
 * `removeEnumValue` changes against an enum that is referenced by a
 * PG composite type. The rename-recreate dance can't reach into
 * composite fields, so the generator refuses to write the migration
 * rather than letting it fail at apply time.
 *
 * The operator's options: drop the composite, restructure it not to
 * use the enum, or keep the value and ship the change later.
 */
export class CompositeEnumReferenceError extends KickDbError {
  readonly refs: readonly CompositeRef[]

  constructor(refs: readonly CompositeRef[]) {
    const summary = refs.map((r) => `${r.composite}.${r.attribute} → ${r.enum}`).join(', ')
    super(
      'composite_enum_reference',
      `Cannot generate migration: the enum value(s) being removed are reachable through ` +
        `composite type field(s) [${summary}]. PostgreSQL's USING-cast in the rename-recreate ` +
        `path can't reach into composite fields, so the migration would fail at apply time. ` +
        `Drop or restructure the composite type(s) first, then re-run \`kick db generate\`.`,
    )
    this.refs = refs
  }
}
