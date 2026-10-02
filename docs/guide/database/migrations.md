# Migrations

`@forinda/kickjs-db` ships **reversible** migrations. `kick db generate` diffs your schema against the last snapshot and writes a forward (`up.sql`) and reverse (`down.sql`) pair plus a snapshot; `kick db migrate latest` applies pending migrations with a lock table, batch tracking, and drift detection. The runner refuses unreviewed migrations outside development, so a deploy never silently mutates your schema.

## Configuration

The migration commands read the `db:` block from `kick.config.ts`:

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  db: {
    schemaPath: 'src/db/schema.ts',
    migrationsDir: 'db/migrations',
    dialect: 'postgres',
    connectionString: process.env.DATABASE_URL,
  },
})
```

`connectionString` (or the `DATABASE_URL` env var) powers the built-in Postgres adapter the CLI uses for `kick db migrate*`. For other dialects — or a custom pool / serverless driver — supply an `adapter` factory instead (see [Non-Postgres dialects](#non-postgres-dialects)).

## File layout

Each migration is a directory under `migrationsDir`:

```
db/migrations/
  20260427_153012_add_users/
    up.sql          # forward DDL (immutable generated-by banner)
    down.sql        # reverse DDL (immutable generated-by banner)
    snapshot.json   # full schema snapshot after this migration
    meta.json       # { id, name, hash, reviewed, dialect, transaction }
  _journal.json     # ordered list of migration ids + content hashes
```

The `hash` in `_journal.json` covers `up.sql` + `down.sql` + `snapshot.json`. Tampering with an applied migration fails the integrity check at `migrate latest` time. Review state lives **only** in `meta.json` (which the hash does not cover), so reviewing a migration never invalidates its hash.

## Generating a migration

<PmCommand exec="kick db generate add_users" />

This:

1. Loads `schemaPath` → builds the **target** snapshot.
2. Loads the latest committed `snapshot.json` → the **previous** snapshot.
3. Diffs them into a change set (`CreateTable`, `AddColumn`, `AlterColumn`, `AddIndex`, `AddForeignKey`, enum changes, …).
4. Emits `up.sql` (forward DDL) and `down.sql` (the inverted change set).
5. Writes `snapshot.json` and `meta.json` (with `reviewed: false`).

If nothing changed, it prints `No schema changes detected.` and exits without writing.

### Renames

A schema file can't say a column was renamed: `fullName` disappears and `name` appears. Taken literally, that is a dropped column and a new empty one, and the data is gone. So when a table or column is dropped and another one could replace it, `kick db generate` asks in a terminal:

```text
Column people.fullName is gone. Was it renamed?
  0) no, drop it
  1) renamed to name
  2) renamed to bio
>
```

Enter (or `0`) drops it; a number renames it. Tables are asked about first, then columns, including those inside a renamed table. A rename that also changes the column's type is a rename plus an alter, so the rows keep their values.

Outside a terminal (CI, scripts) nothing is asked. Name renames with flags instead:

<PmCommand exec="kick db generate rename_users --rename-table users=people --rename-column people.fullName=name" />

Without a flag, a single dropped column whose replacement has the same type, nullability and default is still taken as a rename. Any other drop that could be a rename prints a warning with the flag that would keep it, and the drop goes into the migration. `--no-interactive` skips the questions in a terminal too.

### Empty migrations

For data migrations or any change the diff engine can't author, generate an empty shell and write the SQL by hand (re-runnable sample data belongs in [`kick db seed`](./cli.md#seed) instead):

<PmCommand exec="kick db generate backfill_usernames --empty" />

This writes `up.sql` / `down.sql` with just the generated-by banner and copies the prior snapshot (so the next diff-based generate stays consistent).

### Migrations written in TypeScript

When a data change needs code (reading rows, computing values, calling a helper), write the migration in TypeScript:

<PmCommand exec="kick db generate backfill_status --ts" />

This writes a `migration.ts` next to the usual files:

```ts
import type { MigrationDb } from '@forinda/kickjs-db'

export async function up(db: MigrationDb): Promise<void> {
  const users = await db
    .selectFrom('users')
    .select(['id', 'email'])
    .where('status', 'is', null)
    .execute()
  for (const u of users) {
    await db
      .updateTable('users')
      .set({ status: statusFor(u.email) })
      .where('id', '=', u.id)
      .execute()
  }
}

export async function down(db: MigrationDb): Promise<void> {
  await db.updateTable('users').set({ status: null }).execute()
}
```

- **Transactions.** `db` is Kysely on the migration's transaction, and the migration is recorded on the same one, so a throw in `up()` leaves neither its changes nor a record. With `"transaction": false` in `meta.json` it runs on the connection instead.
- **Untyped `db`.** It's `Kysely<any>`: the schema keeps changing after the migration is written, so typing it against today's tables would break it later.
- **Data, not schema.** The snapshot is carried over as with `--empty`, so schema changes still belong in generated migrations. A table changed here shows up as drift.
- **Review and hashing.** `migration.ts` is hashed with the migration's other files, so an edit after `kick db migrate review` is refused like an SQL edit. `up.sql` / `down.sql` stay as placeholders and aren't run.
- **Rolling back.** Leave out `down()` if the change can't be reversed; `migrate down` then fails with a clear message.
- **Runtime.** It loads through jiti like the schema, so extensionless imports of your own code work. It needs a migration adapter with `kysely()`; the Postgres, MySQL and SQLite adapters have one.

### The review gate

Generated SQL files open with an immutable provenance banner (`-- Generated by @forinda/kickjs-db vX.Y.Z — review state lives in meta.json`). The runner **refuses** to apply any migration whose `meta.json.reviewed` is `false` unless `NODE_ENV === 'development'`. This is deliberate — the down draft makes a defensible choice for ambiguous reverses (dropped columns, widened types, dropped tables), and you're expected to read it before it runs in CI / prod.

To approve a migration, review the SQL and run:

<PmCommand exec="kick db migrate review <id>" />

This flips `meta.json.reviewed` to `true` — the SQL files are untouched, so the journal hash stays valid. (Migrations generated by older versions carry an in-file `-- REVIEWED:` marker; the review command migrates those too, swapping the marker and re-syncing the hash.)

::: tip Why the gate exists
Reversing a "drop column" or "widen `varchar(50)` → `text`" is inherently lossy — the down draft picks the last-known type but can't recover data. The reviewed flag forces a human to confirm the reverse is acceptable before any non-dev environment applies it.
:::

## Running migrations

All subcommands take `-c, --config <path>` (default `kick.config.ts`).

| Command                    | Behavior                                         |
| -------------------------- | ------------------------------------------------ |
| `kick db migrate latest`   | Apply **all** pending migrations in a new batch. |
| `kick db migrate up`       | Apply the **next single** pending migration.     |
| `kick db migrate down`     | Reverse the **most recent** applied migration.   |
| `kick db migrate rollback` | Reverse the **entire last batch** as one unit.   |
| `kick db migrate status`   | Print applied + pending migrations as a table.   |

```bash
kick db migrate latest
# Applied batch 3: 20260427_153012_add_users, 20260428_091500_add_posts

kick db migrate status
# id                          state    batch  reviewed  applied
# 20260427_153012_add_users   applied  3      true      2026-04-27T...
# 20260429_120000_add_tags    pending  -      false     -
```

### How `migrate latest` works

1. Acquire the single-row migration lock (`kick_migrations_lock`). A collision means another process is mid-migration — the command throws `MigrationLockError`.
2. **Drift check** — introspect the live DB and compare against the last applied migration's `snapshot.json`. A mismatch throws `MigrationDriftError`. Behavior is `error` (default), `warn`, or `ignore`.
3. Compute the pending set (journal entries not yet recorded as applied).
4. Verify each pending migration: outside development it must be reviewed, and a reviewed one must still match the hash `review` recorded.
5. Allocate the next batch number.
6. Apply each `up.sql` in order, each in its own transaction, and record it in `kick_migrations` in that same transaction — on Postgres and SQLite, so a crash can't leave a migration applied but unrecorded. Exceptions, where the record is written after the SQL and a crash in between leaves the migration applied but unrecorded:
   - MySQL, for a migration with DDL — MySQL commits `CREATE` / `ALTER` / `DROP` as they run;
   - a migration with `meta.json.transaction === false`, which runs outside a transaction — `generate` writes one for each [`.concurrently()`](./constraints.md#partial-expression-and-other-indexes) index change;
   - a custom adapter without `applyMigrationInTx`.

   If that happens, the retry fails on "already exists": check the schema, then record the migration as applied without running it ([the baseline script](./adopting.md#_3-baseline-the-migration-history)), or undo its changes and run it again.

7. Release the lock.

### Batches and rollback

`migrate latest` stamps everything it applies with the same batch number. `migrate rollback` reverses that whole batch as a unit (in reverse-applied order, so FKs drop before tables); `migrate down` reverses just the single most recent migration.

## Running migrations from code

Everything the CLI does is exported, for a deploy script, a job, or an admin endpoint. Each runner takes a migration adapter for your dialect and the migrations folder:

```ts
import pg from 'pg'
import { migrateLatest, migrateRollback, migrateStatus } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db/pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const adapter = pgAdapter({ pool })
const migrationsDir = 'db/migrations'

const { applied, batch } = await migrateLatest({ adapter, migrationsDir })
const status = await migrateStatus({ adapter, migrationsDir }) // [{ id, state, batch, reviewed, … }]
await migrateRollback({ adapter, migrationsDir }) // the last batch
```

| Function                                   | Same as                             |
| ------------------------------------------ | ----------------------------------- |
| `migrateLatest` / `migrateUp`              | `kick db migrate latest` / `up`     |
| `migrateDown` / `migrateRollback`          | `kick db migrate down` / `rollback` |
| `migrateStatus`                            | `kick db migrate status`            |
| `generate({ name, config, cwd, renames })` | `kick db generate`                  |
| `reviewMigration(migrationsDir, id)`       | `kick db migrate review`            |
| `checkMigrations({ config, cwd })`         | `kick db check`                     |
| `runSeeds({ dir, names })`                 | `kick db seed`                      |

The runners take the same lock as the CLI, so two callers can't apply migrations at once, and keep the same checks: unreviewed migrations are refused outside development (`requireReviewed: false` turns that off), and drift is checked first (`driftCheck: 'warn' | 'ignore'`). `sqliteAdapter` and `mysqlAdapter` come from `@forinda/kickjs-db/sqlite` and `/mysql`.

Exposing these over HTTP is exposing schema changes to whoever can call the route. Put it behind authentication you trust with that, and prefer running them from a deploy step.

## Boot-time policy

`kickDbAdapter()` decides what to do about pending migrations when the app boots, via `migrationsOnBoot`:

```ts
import { kickDbAdapter } from '@forinda/kickjs-db'
import { migrationAdapter } from './db/client'

kickDbAdapter({
  migrationAdapter,
  migrationsDir: 'db/migrations',
  migrationsOnBoot: process.env.NODE_ENV === 'development' ? 'apply' : 'fail-if-pending',
  driftCheck: 'error',
})
```

- `'fail-if-pending'` (default) — throw on boot if anything is pending. Operators run `kick db migrate latest` explicitly before a deploy. This avoids the footgun where migrations silently apply on every deploy.
- `'apply'` — run `migrateLatest()` automatically. Good for dev / preview.
- `'ignore'` — boot regardless.

`driftCheck` and `requireReviewed` flow through to the runner. When a `bus` is wired, a `db:migration-applied` event fires after a successful boot apply so the DevTools panel can surface it.

## Enum value removal

Removing a Postgres enum value is a destructive, rename-recreate operation. The generated migration carries a `-- KICK ENUM REMOVE` header and the runner **refuses** it unless you pass the confirmation flag:

```bash
kick db migrate latest --confirm-enum-drop
kick db migrate up --confirm-enum-drop
```

At `kick db generate` time, the Postgres path also probes for composite-type references to the enum (the rename-recreate `USING`-cast can't reach into composite fields) and aborts with `CompositeEnumReferenceError` if any exist.

## Primary keys and CHECKs

Changing a table's primary key — other columns, another order, a new name — generates a key change rather than a column change:

| Dialect  | Emitted                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| Postgres | `DROP CONSTRAINT "<old>"` before any column is dropped, `ADD CONSTRAINT "<new>" PRIMARY KEY (…)` after columns are added |
| MySQL    | `DROP PRIMARY KEY, ADD PRIMARY KEY (…)` in one statement (an `AUTO_INCREMENT` column must stay keyed)                    |
| SQLite   | a table rebuild                                                                                                          |

A CHECK that's added, removed or whose expression changed becomes `ADD CONSTRAINT … CHECK` / `DROP CONSTRAINT` (MySQL: `DROP CHECK`); on SQLite, a table rebuild. Down migrations reverse both.

A SQLite rebuild copies every row into a new table. Before committing, the migration runs `PRAGMA foreign_key_check` and rolls back if any row now points at a parent that isn't there — fix the data and migrate again.

Drift detection compares a key's columns, not its name, and doesn't compare CHECK constraints.

## Introspection

Generate a TypeScript schema file from a live database — useful for bootstrapping from an existing DB or recovering from drift:

```bash
# Write a schema file (defaults to db.schemaPath)
kick db introspect --out src/db/schema.ts

# Or dump the raw snapshot JSON
kick db introspect --json
```

`introspect()` is implemented for all three dialects (Postgres via `information_schema`, SQLite via `sqlite_master` + `PRAGMA`, MySQL via `information_schema`).

::: tip Lossy types on SQLite / MySQL
SQLite and MySQL don't preserve the code-first type (a `uuid()` column reads back as `text` / `char(36)`), so introspection is best for **reverse-engineering** an existing database. Drift detection accounts for this — it normalises both sides before comparing, so it never false-positives on the type difference. Tune it per-project with `db.driftCheck` (`'error'` default, `'warn'`, or `'ignore'`).
:::

## Non-Postgres dialects

The built-in CLI adapter resolves a Postgres pool from `connectionString`. For SQLite or MySQL, supply an `adapter` factory in the `db:` block that returns a fully-constructed `MigrationAdapter`:

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  db: {
    schemaPath: 'src/db/schema.ts',
    migrationsDir: 'db/migrations',
    dialect: 'sqlite',
    adapter: async () => {
      const Database = (await import('better-sqlite3')).default
      const { sqliteAdapter } = await import('@forinda/kickjs-db/sqlite')
      return sqliteAdapter({ database: new Database('app.db') })
    },
  },
})
```

The `adapter` factory takes precedence over `connectionString` when both are set. See [Drivers](./drivers) for the per-dialect adapter factories and their connection options.

A factory that opens a pool — MySQL, or Postgres through your own `pg.Pool` — should pass `endPoolOnClose: true`, so the pool closes when the command finishes and `kick db` exits:

```ts
adapter: async () => {
  const { createPool } = await import('mysql2/promise')
  const { mysqlAdapter } = await import('@forinda/kickjs-db/mysql')
  return mysqlAdapter({ pool: createPool({ uri: process.env.DATABASE_URL! }), endPoolOnClose: true })
},
```

The app's own adapter can take it too: `kickDbAdapter` closes the adapter when the app shuts down, so the shared pool ends with the app. See [Connections and Pooling](./pooling.md).
