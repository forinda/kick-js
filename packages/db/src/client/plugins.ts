import {
  BinaryOperationNode,
  OperationNodeTransformer,
  OperatorNode,
  ValueNode,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow,
} from 'kysely'

// M5 follow-up — kickjs-side workaround for the broken
// SafeNullComparisonPlugin shipped in Kysely 0.29
// (kysely/dist/plugin/safe-null-comparison/safe-null-comparison-transformer.js).
//
// The upstream transformer rewrites `=` / `!=` / `<>` against
// literal `null` to `IS` / `IS NOT` at AST level but keeps the null
// operand as a `ValueNode(null)`, which the PG compiler then
// parameterises. Result: `WHERE "col" IS $1` with `$1=null` —
// invalid PostgreSQL syntax. PG's `IS` predicate grammar requires
// specific predicates (`NULL`, `TRUE`, `FALSE`, `UNKNOWN`,
// `DISTINCT FROM ...`), not an arbitrary parameter placeholder.
//
// Verified empirically against postgres:16-alpine in
// `packages/db-pg/__tests__/integration/kysely-safe-null-broken-pg.test.ts`.
// Tracked for upstream follow-up at #220.
//
// Fix: identical AST rewrite, but replace the null `ValueNode` with
// `ValueNode.createImmediate(null)` so the PG compiler emits the
// bare SQL keyword `null` inline (no parameter binding). Output is
// `WHERE "col" IS NULL` / `WHERE "col" IS NOT NULL` — valid PG and
// semantically correct under three-valued logic.
//
// When upstream Kysely fixes their transformer (issue #220), this
// wrapper can collapse to a one-line re-export of
// `kysely`'s plugin. The unit test in
// `__tests__/unit/safe-null-comparison.test.ts` and the PG
// integration test pin the current output, so the diff will surface
// loudly at upgrade time.

class SafeNullComparisonTransformer extends OperationNodeTransformer {
  protected override transformBinaryOperation(node: BinaryOperationNode): BinaryOperationNode {
    const transformed = super.transformBinaryOperation(node)
    const { operator, leftOperand, rightOperand } = transformed

    if (!OperatorNode.is(operator)) return transformed
    if (!ValueNode.is(rightOperand) || rightOperand.value !== null) return transformed

    const op = operator.operator
    if (op !== '=' && op !== '!=' && op !== '<>') return transformed

    return BinaryOperationNode.create(
      leftOperand,
      OperatorNode.create(op === '=' ? 'is' : 'is not'),
      // KEY DIFFERENCE vs Kysely's upstream transformer — `createImmediate`
      // marks the value for inline emission, so the compiler writes the
      // SQL keyword `null` instead of binding the value as a `$N` parameter.
      ValueNode.createImmediate(null),
    )
  }
}

class SafeNullComparisonPlugin implements KyselyPlugin {
  readonly #transformer = new SafeNullComparisonTransformer()

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return this.#transformer.transformNode(args.node)
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result
  }
}

/**
 * Pass this to `createDbClient({ plugins: [...] })` so
 * `eb('col', '=', null)` (plus `!=` / `<>`) compiles to `IS NULL` /
 * `IS NOT NULL` instead of the silently-false `= NULL` default.
 *
 * Without the plugin, Kysely passes `null` through as a bound
 * parameter — the resulting `col = $1` evaluates to UNKNOWN under
 * three-valued logic, which filters out every row including the
 * ones the adopter intended to match. The plugin rewrites the AST
 * before compilation so the operator becomes `IS` / `IS NOT` and
 * the null literal flows inline (no `$N` parameter binding).
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
 * existing repos that work around the gotcha manually don't see a
 * behaviour change.
 *
 * **Why a kickjs-side helper rather than re-exporting Kysely's?**
 * Kysely 0.29's own `SafeNullComparisonPlugin` ships broken on PG —
 * it rewrites the operator but keeps the null operand parameterised,
 * producing `WHERE "col" IS $1` with `$1=null`, which PG rejects
 * with `syntax error at or near "$1"`. The kickjs version emits the
 * literal `null` keyword inline so PG accepts it. Tracked upstream
 * at <https://github.com/forinda/kick-js/issues/220>.
 */
export function safeNullComparison(): KyselyPlugin {
  return new SafeNullComparisonPlugin()
}
