---
description: Every kick db command — generate, check, migrate latest / up / down / rollback / status / review / unlock, introspect — with flags, what each reads and writes, exit codes and real output.
---

# Database CLI

The `kick db` commands — migrations, schema diffs, introspection — ship with `@forinda/kickjs-db`. Run them through the `kick` CLI as a plugin, or through the standalone `kickjs-db` binary, which needs no `@forinda/kickjs-cli`.

## Commands

| Command                                  | Does                                                                      | Needs a database |
| ---------------------------------------- | ------------------------------------------------------------------------- | :--------------: |
| [`generate <name>`](#generate)           | Diff the schema against the last migration and write a new one            |       no ¹       |
| [`check`](#check)                        | Fail if the schema, the migrations and their review state are out of step |        no        |
| [`migrate latest`](#migrate-latest)      | Apply every pending migration as one batch                                |       yes        |
| [`migrate up`](#migrate-up)              | Apply the next pending migration                                          |       yes        |
| [`migrate down`](#migrate-down)          | Reverse the most recently applied migration                               |       yes        |
| [`migrate rollback`](#migrate-rollback)  | Reverse the whole last batch                                              |       yes        |
| [`migrate status`](#migrate-status)      | List applied and pending migrations                                       |       yes        |
| [`migrate review <id>`](#migrate-review) | Mark a migration reviewed                                                 |        no        |
| [`migrate unlock`](#migrate-unlock)      | Release a migration lock a killed run left behind                         |       yes        |
| [`seed [names...]`](#seed)               | Run the seed files in `seedsDir`                                          |       yes        |
| [`introspect`](#introspect)              | Write a schema file from a live database                                  |       yes        |

¹ On Postgres with a `connectionString` (and no `adapter` factory), `generate` connects to check enum changes against composite types; otherwise it reads only files.

Every command exits `0` on success and `1` on failure, printing the error's message. [Troubleshooting](./troubleshooting.md) lists the messages and what to do about each.

## Setup

### As a `kick` plugin

Add `dbCliPlugin` to `kick.config.ts`. The commands read the same file's `db` block:

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'
import { dbCliPlugin } from '@forinda/kickjs-db/cli'

export default defineConfig({
  plugins: [dbCliPlugin],
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

The plugin is opt-in: without it `kick db` is an unknown command. It also adds the schema types to `kick typegen` (see [`kick typegen`](#kick-typegen)). `kick` loads `.env` before running a command, so `NODE_ENV=development` there lets unreviewed migrations apply locally.

### Standalone `kickjs-db`

The same commands without `@forinda/kickjs-cli`:

<PmCommand exec="kickjs-db migrate status" />

It reads the `db` block of `kick.config.ts` and a `kickjs-db.config.ts`, if either exists — the standalone file wins where both set a field:

```ts
// kickjs-db.config.ts
import { defineKickDbConfig } from '@forinda/kickjs-db/cli'

export default defineKickDbConfig({
  dialect: 'sqlite',
  schemaPath: 'src/db/schema.ts',
  migrationsDir: 'db/migrations',
  adapter: async () => {
    const Database = (await import('better-sqlite3')).default
    const { sqliteAdapter } = await import('@forinda/kickjs-db/sqlite')
    return sqliteAdapter({ database: new Database('app.db') })
  },
})
```

A `.ts` or `.mts` config loads through `jiti` (`npm i -D jiti`); `.js`, `.mjs` and `.json` don't need it. The standalone binary doesn't load `.env` — set `NODE_ENV` and `DATABASE_URL` in the environment.

### Config fields

The `kick.config.ts` `db` block and `kickjs-db.config.ts` share one shape:

| Field              | Type                                  | Default              | Description                                                                                                                          |
| ------------------ | ------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `schemaPath`       | `string`                              | `'src/db/schema.ts'` | The schema module `generate` and `check` read.                                                                                       |
| `migrationsDir`    | `string`                              | `'db/migrations'`    | Where migrations and `_journal.json` live.                                                                                           |
| `seedsDir`         | `string`                              | `'db/seeds'`         | Where `kick db seed` finds seed files.                                                                                               |
| `dialect`          | `'postgres' \| 'sqlite' \| 'mysql'`   | `'postgres'`         | The SQL `generate` writes.                                                                                                           |
| `connectionString` | `string`                              | `DATABASE_URL`       | Postgres only — the built-in adapter connects with it when there's no `adapter`.                                                     |
| `adapter`          | `() => MigrationAdapter \| Promise<>` | —                    | Builds the connection the commands use. Required for SQLite and MySQL; wins over `connectionString`.                                 |
| `driftCheck`       | `'error' \| 'warn' \| 'ignore'`       | `'error'`            | What `migrate` does when the live database has schema no migration recorded — see [Drift](./migrations.md#how-migrate-latest-works). |

An `adapter` factory that opens a pool — MySQL, or your own `pg.Pool` — should pass `endPoolOnClose: true`, so the command can exit when it's done ([Troubleshooting](./troubleshooting.md#kick-db-never-exits)).

### Config helpers

| Helper                                  | Purpose                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `defineKickDbConfig(cfg)`               | Typed identity helper for `kickjs-db.config.ts`.                                 |
| `mergeKickDbConfig(...cfgs)`            | Shallow-merge config layers; later wins.                                         |
| `resolveKickDbConfig(block)`            | Apply the defaults above to a config block.                                      |
| `registerDbCommands(parent, getConfig)` | Attach the command tree to any commander command — for building your own binary. |

The examples below run against SQLite.

## generate

```text
kick db generate <name> [-e, --empty]
```

Diffs `schemaPath` against the last migration's `snapshot.json` and writes `db/migrations/<YYYYMMDD_HHMMSS>_<name>/` — `up.sql`, `down.sql`, `snapshot.json`, `meta.json` — plus an entry in `_journal.json`. The new migration starts unreviewed.

<PmCommand exec="kick db generate create_notes" />

```text
Created migration /app/db/migrations/20261002_180007_create_notes (1 change).
```

With nothing to do:

```text
No schema changes detected.
```

| Flag          | Effect                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `-e, --empty` | Skip the diff and write an empty migration for SQL you write yourself — a backfill, a seed. The snapshot is the previous one. |

```text
Created empty migration /app/db/migrations/20261002_180018_seed_notes (author up.sql + down.sql).
```

When a reverse can't be generated exactly — a dropped column, a dropped table, a type change — `down.sql` starts with `-- DRAFT: ambiguous reverses present …`; read it before you rely on it. [Migrations](./migrations.md#generating-a-migration) covers the output in detail.

Write your SQL into the migration before you review it: `kick db migrate review` records a hash of the files as reviewed, and an edit after that is refused until it's reviewed again ([Troubleshooting](./troubleshooting.md#hash-mismatch-for-migration)).

## check

```text
kick db check
```

Everything `migrate latest` would refuse, found from the files alone — no database. Run it in CI ([CI and deploy](./ci-deploy.md)) so a missing, unreviewed or edited migration fails the build, not the deploy. It fails when:

- the schema has changes no migration covers;
- a migration isn't reviewed;
- a reviewed migration's files changed after review.

```text
Migrations are in step with the schema.
```

```text
The schema has 1 change no migration covers — run `kick db generate <name>`.
20261002_180017_add_pinned is not reviewed — read it, then `kick db migrate review 20261002_180017_add_pinned`.
20261002_180017_add_pinned was edited after it was reviewed — review it again, or revert the edit.
```

Exit code `1` when anything is listed. The same check is exported as `checkMigrations({ config, cwd })`.

## migrate latest

```text
kick db migrate latest [--confirm-enum-drop]
```

Applies every pending migration in one new batch. Before it applies anything it takes the migration lock, checks each pending migration's hash and — outside `NODE_ENV=development` — that it's reviewed, and compares the live database with the last applied snapshot ([drift](./migrations.md#how-migrate-latest-works)). Each migration runs in its own transaction where the dialect allows; MySQL commits DDL as it goes ([Recovering from a failed migration](./migration-recovery.md)).

```text
Applied batch 2: 20261002_180017_add_pinned, 20261002_180018_seed_notes
```

```text
No pending migrations.
```

| Flag                  | Effect                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--confirm-enum-drop` | Allow a migration that removes values from a Postgres enum (it carries a `-- KICK ENUM REMOVE` header). Read its `USING` casts first. |

## migrate up

```text
kick db migrate up [--confirm-enum-drop]
```

Applies only the next pending migration, as its own batch. Same checks and flag as `migrate latest`.

```text
Applied 20261002_180007_create_notes (batch 1)
```

## migrate down

```text
kick db migrate down
```

Runs the most recently applied migration's `down.sql` and marks it pending again.

```text
Reversed 20261002_180018_seed_notes.
```

```text
Nothing to reverse.
```

## migrate rollback

```text
kick db migrate rollback
```

Reverses the whole last batch — everything one `migrate latest` applied — newest first.

```text
Rolled back batch 2: 20261002_180017_add_pinned
```

```text
Nothing to roll back.
```

## migrate status

```text
kick db migrate status
```

Every migration in the journal, with its state, batch and review flag:

```text
┌─────────┬────────────────────────────────┬───────────┬───────┬──────────┬───────────────────────┐
│ (index) │ id                             │ state     │ batch │ reviewed │ applied               │
├─────────┼────────────────────────────────┼───────────┼───────┼──────────┼───────────────────────┤
│ 0       │ '20261002_180007_create_notes' │ 'applied' │ 1     │ true     │ '2026-10-02 18:00:09' │
│ 1       │ '20261002_180017_add_pinned'   │ 'pending' │ '-'   │ true     │ '-'                   │
└─────────┴────────────────────────────────┴───────────┴───────┴──────────┴───────────────────────┘
```

It exits `0` whether or not anything is pending; use `kick db check` and the app's boot policy to gate on that.

## migrate review

```text
kick db migrate review <id>
```

Marks a migration reviewed by setting `reviewed: true` in its `meta.json` — the step that says someone read the SQL. Outside `NODE_ENV=development` the runner applies only reviewed migrations. Touches no database.

```text
Reviewed 20261002_180017_add_pinned — it can now be applied.
```

```text
20261002_180017_add_pinned was already reviewed.
```

## migrate unlock

```text
kick db migrate unlock
```

Releases the migration lock. The runner holds it while it migrates and releases it when it finishes — even on failure — but a process that was killed (out of memory, a deploy timeout) never gets the chance, and every later run stops with `Another process holds the migration lock`. Run this only when you're sure no migration is running.

```text
Released the migration lock.
```

## seed

```text
kick db seed [names...]
```

Runs the seed files in `seedsDir` (`db/seeds`) in name order — prefix them to order them (`01_roles.ts`, `02_admin.ts`) — or only the ones named, with or without the extension. Each file default-exports an async function and imports what it needs, usually the app's own client:

```ts
// db/seeds/01_admin.ts
import { db } from '../../src/db/client'
import { hashPassword } from '../../src/auth/password'

export default async function seed() {
  await db.findOrCreate('users', {
    where: { email: 'admin@example.com' },
    create: { name: 'Admin', passwordHash: await hashPassword(process.env.ADMIN_PASSWORD!) },
  })
}
```

```text
Ran 1 seed(s): 01_admin.ts
```

Nothing records which seeds ran — they aren't migrations, and every run runs them all. Write them to be run again: [`db.upsert()`](./queries.md#upsert-and-find-or-create) and `db.findOrCreate()` make that one line. A seed that throws stops the run with `Seed <file> failed: <message>` and exit code `1`; `kick db seed <name>` that matches no file fails before anything runs. The command exits when the seeds finish, even though the client they imported still holds its pool.

Seed files load the way the app's code does — TypeScript, extensionless relative imports. For schema changes, data fixes that must run exactly once, or anything a deploy depends on, write a migration (`kick db generate <name> --empty`) instead.

## introspect

```text
kick db introspect [--out <path>] [--json]
```

Reads the live database and writes a schema file for it — the first step of [adopting kick/db on an existing database](./adopting.md).

| Flag           | Effect                                                                             |
| -------------- | ---------------------------------------------------------------------------------- |
| `--out <path>` | Where to write the file. Default: `schemaPath` — **which overwrites your schema**. |
| `--json`       | Print the raw snapshot JSON instead of writing a file.                             |

<PmCommand exec="kick db introspect --out src/db/introspected.ts" />

```text
Wrote src/db/introspected.ts (1 table).
```

```ts
import { table, text } from '@forinda/kickjs-db'

export const notes = table('notes', {
  id: text().primaryKey().default('lower(hex(randomblob(4)) || …)'),
  title: text().notNull(),
  body: text(),
  createdAt: text().notNull().default("strftime('%Y-%m-%d %H:%M:%f', 'now')"),
})
```

SQLite and MySQL keep less type information than the schema had — `uuid()` comes back as `text`, `varchar(200)` as `text`, defaults as raw SQL — so read the result and put the types back before you use it.

## kick typegen

With `dbCliPlugin` mounted, `kick typegen` (which `kick dev` runs on every save) also writes `.kickjs/types/kick__db.d.ts`: the row types for an injected `KickDbClient`, and the relation names `db.query … { with }` accepts. Run it after changing `relations()` if the editor doesn't see the new relation — [Schema Types](../db-schema-types.md).

## Related

- [Migrations](./migrations.md) — how generating, reviewing and applying fit together
- [CI and deploy](./ci-deploy.md) — where each command runs in a pipeline
- [Recovering from a failed migration](./migration-recovery.md)
- [Troubleshooting](./troubleshooting.md)
