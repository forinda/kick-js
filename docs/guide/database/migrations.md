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
    up.sql          # forward DDL
    down.sql        # reverse DDL (REVIEWED: false header until reviewed)
    snapshot.json   # full schema snapshot after this migration
    meta.json       # { id, name, hash, reviewed, dialect, transaction }
  _journal.json     # ordered list of migration ids + content hashes
```

The `hash` in `_journal.json` covers `up.sql` + `down.sql` + `snapshot.json`. Tampering with an applied migration fails the integrity check at `migrate latest` time.

## Generating a migration

```bash
kick db generate add_users
```

This:

1. Loads `schemaPath` → builds the **target** snapshot.
2. Loads the latest committed `snapshot.json` → the **previous** snapshot.
3. Diffs them into a change set (`CreateTable`, `AddColumn`, `AlterColumn`, `AddIndex`, `AddForeignKey`, enum changes, …).
4. Emits `up.sql` (forward DDL) and `down.sql` (the inverted change set).
5. Writes `snapshot.json` and `meta.json` (with `reviewed: false`).

If nothing changed, it prints `No schema changes detected.` and exits without writing.

### Empty migrations

For data migrations, seeds, or any change the diff engine can't author, generate an empty shell and write the SQL by hand:

```bash
kick db generate backfill_usernames --empty
```

This writes `up.sql` / `down.sql` with just the reviewed header and copies the prior snapshot (so the next diff-based generate stays consistent).

### The review gate

Generated `down.sql` is headed `-- REVIEWED: false`. The runner **refuses** to apply any migration whose `meta.json.reviewed` is `false` unless `NODE_ENV === 'development'`. This is deliberate — the down draft makes a defensible choice for ambiguous reverses (dropped columns, widened types, dropped tables), and you're expected to read it before it runs in CI / prod.

To approve a migration, review the SQL and set `"reviewed": true` in its `meta.json`.

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
4. Verify each pending migration's content hash matches the journal, and (outside dev) that it's reviewed.
5. Allocate the next batch number.
6. Apply each `up.sql` in order — each in its own transaction unless `meta.json.transaction === false` (for cases like PG `CREATE INDEX CONCURRENTLY`) — and record it.
7. Release the lock.

### Batches and rollback

`migrate latest` stamps everything it applies with the same batch number. `migrate rollback` reverses that whole batch as a unit (in reverse-applied order, so FKs drop before tables); `migrate down` reverses just the single most recent migration.

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

## Introspection

Generate a TypeScript schema file from a live database — useful for bootstrapping from an existing DB or recovering from drift:

```bash
# Write a schema file (defaults to db.schemaPath)
kick db introspect --out src/db/schema.ts

# Or dump the raw snapshot JSON
kick db introspect --json
```

::: warning Postgres-only introspection in v1
`introspect()` is implemented for Postgres. SQLite and MySQL throw `KickDbError` with code `KICK_DB_INTROSPECT_NOT_SUPPORTED` — set `driftCheck: 'off'` (or `'ignore'`) on those dialects until a follow-up lands the introspection walk.
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
