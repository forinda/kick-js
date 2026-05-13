# Spec: SQL emission threat model

> Status: Draft v1
> Date: 2026-05-13
> Owner: @forinda
> Tracking: architecture spec §13 hardening item

Confirms the SQL injection / unsafe-emission surface area of `@forinda/kickjs-db` and the dialect peer packages. The bar: every SQL emission path either (a) flows runtime values through a parameter-binding mechanism, or (b) operates on schema-author-controlled values that the adopter has already committed to as code.

## 1. Trust boundary

Two classes of input flow into SQL:

| Class                  | Source                                                                              | Trust                       | Safe path                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| **Schema identifiers** | `table('users', ...)`, `relations(...)`, `customType({ dataType })`                 | Code-time, adopter-authored | `quoteIdent` (identifiers), trusted-raw (type strings, default expressions) |
| **Runtime values**     | `where('col', '=', userInput)`, `insert(...).values({ name: req.body.name })`, etc. | User-controlled at runtime  | Kysely's `ExpressionBuilder` → parameter binding (`$N` / `?` / `@N`)        |

The trust boundary is **time of authorship**: anything declared via the schema DSL or fed through `customType()` is code; anything passed into a query method at runtime is user-controlled and MUST flow through parameter binding.

## 2. Audited emission paths

### 2.1 DDL emission — `packages/db/src/emit/`

Files: `pg.ts`, `alter-type.ts`.

- **All identifiers** (table names, column names, index names, FK constraint names, enum type names) flow through `quoteIdent(name)` (`identifiers.ts`), which wraps in double-quotes and doubles internal `"` per the SQL standard.
- **All literal values** (defaults that aren't pass-through keywords, enum values) flow through `quoteLiteral(value)`, which wraps in single quotes and doubles internal `'`.
- **Pass-through keywords / function calls** in defaults — `formatDefault` recognizes `CURRENT_TIMESTAMP`, `true`/`false`, numeric literals, and the function-call pattern `^[a-z_][a-z0-9_]*\s*\([^)]*\)$/i`. These are emitted bare; the recognizer is restrictive enough that an adopter would have to deliberately bypass it (e.g. by writing `default: '0); DROP TABLE users; --'` and somehow making it match the numeric regex — which it doesn't).
- **Type strings** — `column.type`, `change.after.type` are interpolated raw. These come from the DSL constructors (`varchar(255)`, `serial`, etc.) or `customType({ dataType })`. Adopter-controlled at code time; trusted.

**Verdict:** safe under the trust boundary. An adopter who deliberately injects via `customType` is injecting into their own code path; not in scope.

### 2.2 Query emission — `packages/db/src/query/`

Files: `compile-shared.ts`, `compile-pg.ts`, `compile-mysql.ts`, `compile-sqlite.ts`.

- The relational query layer is a thin wrapper over Kysely's `selectFrom` / `where` / `orderBy` / `limit` / `with` plus per-dialect JSON-aggregation helpers (`jsonArrayFrom`, `jsonObjectFrom`).
- **`db.selectFrom(\`${table} as ${alias}\`)`** in `compile-shared.ts:98`: `table` is the table name from the schema (code-time). `alias` is `${table}_${depth}` derived from the same. Kysely's selectFrom parses the `name as alias` shorthand and quotes both sides.
- **`where: (proxy, eb) => ...`** delegates to Kysely's `ExpressionBuilder`. Any value the adopter passes (`eb('col', '=', value)`, `eb('col', 'in', userArray)`, etc.) compiles to a parameterised `ValueNode` → `$N` / `?` / `@N` placeholder + bound parameter at execution. No string interpolation of values.
- **Operator strings** in `eb` (`'='`, `'<'`, `'is null'`, etc.) come from a typed union; Kysely rejects unrecognised operators at compile time.

**Verdict:** safe — Kysely handles parameterisation. Adopter user input flows through `ValueNode`, never raw concatenation.

### 2.3 Migration runner — `packages/db/src/migrate/`

Files: `runner.ts`, `journal.ts`, `introspect-pg.ts`, `adapter.ts`.

- The runner inserts rows into `kick_migrations` via `migrationAdapter.insertRow()`. Implementations (`packages/db-pg/src/adapter.ts:PgMigrationAdapter`) use parameterised queries (`pg.Client.query(sql, params)`).
- `introspectPg()` queries `information_schema.*` and `pg_catalog.*` with bound parameters for schema name. The schema name is adopter-supplied via `RunnerOptions.schema` (default `'public'`); flows as a `$1` parameter, not interpolated.
- Migration `up.sql` / `down.sql` content is the **output** of `emit/pg.ts` (audited above) — not adopter user input at runtime.

**Verdict:** safe. Schema-name parameter binding plus emit-audited DDL.

### 2.4 Snapshot extraction — `packages/db/src/snapshot/extract.ts`

Operates on in-memory DSL objects. No SQL emission. Out of scope.

## 3. Adversarial input coverage

`packages/db-pg/__tests__/integration/sql-injection-pg.test.ts` (added in the same PR as this spec) locks the trust boundary against real PG:

- **Value-binding tests**: insert + retrieve rows where the value contains every SQL-injection metacharacter (`'`, `"`, `;`, `--`, `/**/`, `\0`). Asserts the original value round-trips byte-identical and no out-of-band SQL executes.
- **Identifier-escape tests**: build a table with a name containing quotes (PG accepts double-quoted weird identifiers) and verify `emit/pg.ts` produces SQL PG accepts.

When this spec changes (new emit path, new query helper), the corresponding test is updated. A regression on the trust boundary therefore surfaces in CI.

## 4. Out-of-scope (documented for clarity)

- **Adopter-defined `customType({ dataType: () => 'some-sql' })`**: the `dataType` callback returns a string that's interpolated raw into DDL. If an adopter writes `customType({ dataType: () => 'text); DROP TABLE x; --' })`, the injected SQL fires on migration generation. This is equivalent to the adopter writing the same SQL by hand — they have full code execution, so the trust boundary is irrelevant. Not in scope.
- **DSL constructor strings** (`varchar(N)`, `decimal(p, s)`): same as above. These are code-time, adopter-controlled.
- **`sql` template tag** (Kysely's `sql\`...\``): adopters using this opt out of parameterisation explicitly. Kysely's docs cover the responsibility shift.
- **Raw migration SQL** (`up.ts` / `down.ts` escape hatch): adopters writing raw SQL in TS migration files are responsible for their own escaping. Not in scope.

## 5. Re-audit triggers

This spec should be re-checked when:

- A new SQL emission path is added (new dialect emitter, new query helper).
- A new DSL escape hatch is added (raw-SQL injection, dynamic identifier generation).
- Kysely is upgraded across a major (parameterisation behaviour could change).

The audit lives in `packages/db-pg/__tests__/integration/sql-injection-pg.test.ts` — running that test against a real PG container provides the empirical confirmation that this spec still holds.
