---
description: kick/db error messages and what to do about each — unreviewed and edited migrations, drift, a stuck lock, pending migrations on boot, a CLI that won't exit, SQLite and MySQL specifics — plus an FAQ.
---

# Troubleshooting

Find the message you see, read why it happens, apply the fix. Messages are quoted as kick/db prints them; `<id>` stands for a migration folder name such as `20261002_180017_add_pinned`.

## Migrations

### `Migration <id> is unreviewed`

```text
Migration <id> is unreviewed (meta.json reviewed: false) — run `kick db migrate review <id>` before applying outside dev
```

**Why.** Outside `NODE_ENV=development` the runner applies only migrations someone marked as read. `kick db check` reports the same thing as `<id> is not reviewed`.

**Fix.** Read the migration's `up.sql`, then:

<PmCommand exec="kick db migrate review <id>" />

Commit the changed `meta.json`. In development, `kick` loads `.env`, and `NODE_ENV=development` there skips the gate.

### `Hash mismatch for migration`

```text
Hash mismatch for migration <id>
```

`kick db check` says `<id> was edited after it was reviewed — review it again, or revert the edit.`

**Why.** `kick db migrate review` records a hash of the migration's `up.sql`, `down.sql` and `snapshot.json` as you approved them, and the runner refuses a reviewed migration whose files no longer match. Something changed them after review: an edit, a merge, an editor that rewrote line endings.

**Fix.** It depends on whether the migration has run anywhere.

- **Already applied somewhere** — don't edit it. Put the files back (`git checkout db/migrations/<id>`) and make the change in a new migration.
- **Not applied anywhere, and you changed it on purpose** — read the change, then review it again: `kick db migrate review <id>` records the new contents as reviewed.

Before review a migration is a draft: filling in an `--empty` migration or editing a generated one needs nothing special — the review records whatever you approve.

### `Schema drift detected`

```text
Schema drift detected: 1 added, 0 removed, 0 changed (added: users.bio)
```

**Why.** Before it migrates, the runner reads the live database and compares it with the snapshot of the last applied migration. They differ, so something changed the schema outside a migration — a hand-run `ALTER`, another tool, a restored backup. `added` is something the database has that the migrations don't; `removed` the opposite; `changed` a column whose type, nullability or key differs.

**Fix.** The message names what differs; `kick db introspect --json` prints the whole live schema, and the last migration's `snapshot.json` is what was expected.

- The change was a mistake — undo it in the database.
- The change should stay — add it to `schema.ts`, `kick db generate` a migration for it, and apply that migration to the databases that don't have it yet. Where it already exists, mark it applied by hand, or relax the check while you do: `driftCheck: 'warn'` logs instead of stopping, `'ignore'` skips it.

[Migrations](./migrations.md#how-migrate-latest-works) covers when the check runs.

### `Another process holds the migration lock`

```text
Another process holds the migration lock. If none is running — a deploy was killed mid-migration — release it with `kick db migrate unlock`.
```

**Why.** The runner takes a lock so two deploys can't migrate at once, and releases it when it finishes — even when a migration fails. A process that was killed mid-run (out of memory, a deploy timeout, `SIGKILL`) never releases it.

**Fix.** Make sure no migration is actually running — another deploy, a pod still starting — then:

<PmCommand exec="kick db migrate unlock" />

Then check what the killed run left: [Recovering from a failed migration](./migration-recovery.md).

### `pending migration(s); run kick db migrate latest before boot`

```text
ERROR [Process] Uncaught exception Error: kickjs-db: 1 pending migration(s); run `kick db migrate latest` before boot
```

The process exits with code `1`.

**Why.** `kickDbAdapter({ migrationsOnBoot: 'fail-if-pending' })` — the default — refuses to serve on a schema older than the code.

**Fix.** Run the migrations as a deploy step before the app starts — [CI and deploy](./ci-deploy.md). In development, `migrationsOnBoot: 'apply'` applies them on boot.

### Removing an enum value

```text
Migration <id> drops value(s) <values> from PostgreSQL enum(s) <enums>. Re-run with `--confirm-enum-drop` (CLI) or `confirmEnumDrop: true` (RunnerOptions) after reviewing the column-USING clauses in up.sql.
```

**Why.** Removing a value rewrites every column that uses the enum; rows holding the removed value need a cast, which is in `up.sql`.

**Fix.** Read the `USING` clauses in `up.sql`, then `kick db migrate latest --confirm-enum-drop`. [Migrations](./migrations.md#enum-value-removal).

## The CLI

### `kick db` never exits

The command prints its result and then hangs.

**Why.** The `db.adapter()` factory in `kick.config.ts` opened a connection pool, and nothing closed it: `mysqlAdapter` and `pgAdapter` leave a pool open by default, because an app shares one pool with its query client.

**Fix.** The CLI's pool has no other owner, so let the adapter close it:

```ts
adapter: async () => {
  const { createPool } = await import('mysql2/promise')
  const { mysqlAdapter } = await import('@forinda/kickjs-db/mysql')
  return mysqlAdapter({ pool: createPool({ uri: process.env.DATABASE_URL! }), endPoolOnClose: true })
},
```

Postgres with a plain `connectionString` and no factory doesn't need it — the built-in adapter closes its own pool.

### `unknown command 'db'`

```text
error: unknown command 'db'
```

**Fix.** The commands are a plugin: add `plugins: [dbCliPlugin]` (from `@forinda/kickjs-db/cli`) to `kick.config.ts` — [Database CLI](./cli.md#as-a-kick-plugin).

### `no adapter resolved`

```text
kickjs-db: no adapter resolved — set db.connectionString (or DATABASE_URL), or supply a db.adapter() factory
```

```text
kickjs-db: the built-in CLI adapter only supports postgres (dialect=sqlite); supply a db.adapter() factory for other dialects
```

**Fix.** For Postgres, set `DATABASE_URL` (or `db.connectionString`). For SQLite and MySQL, add a `db.adapter()` factory — [Database CLI](./cli.md#config-fields).

### `kickjs-db: no config found`

```text
kickjs-db: no config found — add a `kickjs-db.config.ts` (export default defineKickDbConfig({...})) or a `db` block to `kick.config.ts`.
```

The standalone `kickjs-db` binary didn't find either file in the current directory. Run it from the project root. A `.ts` config also needs `jiti` installed.

## SQLite

### `better-sqlite3` won't install or load

pnpm stops with `ERR_PNPM_IGNORED_BUILDS`, or the app fails with `Could not locate the bindings file`, or TypeScript says `Could not find a declaration file for module 'better-sqlite3'`.

**Why.** `better-sqlite3` compiles a native module in an install script, which pnpm only runs for packages you approve, and its types are a separate package.

**Fix.** `kick add sqlite` approves the build and adds `@types/better-sqlite3`. If you installed it by hand, approve it (`pnpm approve-builds`), add the types, and reinstall.

### `SQLite3 can only bind numbers, strings, bigints, buffers, and null`

**Why.** better-sqlite3 accepts only those types. kick/db converts dates, booleans, and `json()` / `jsonb()` / `.array()` column values for you; something else reached the driver as it is — usually an object in a `where`, or a value for a plain `text()` column.

**Fix.** Pass a string, number or `Date`; for structured data, use a `json()` column or a [`customType`](../db-extensions.md) that serialises it.

## Types

### Nested `with` rows aren't typed

A `db.query … { with: { posts: true } }` call is a type error, or `posts` is typed loosely, though it works at run time.

**Fix.** Relation names reach the type system through `kick typegen`, which writes `.kickjs/types/kick__db.d.ts` when `dbCliPlugin` is mounted. `kick dev` runs it on every save; otherwise run `kick typegen` after changing `relations()`. [Schema Types](../db-schema-types.md).

### Token names don't match the convention

```text
  kick typegen: 1 token(s) don't match the §22.2 convention:
    'app/db' (src/db/token.ts) — does not match `<scope>/<PascalKey>[/<suffix>][:<instance>]`
```

A warning, not an error. Name the token `<scope>/<PascalKey>` — `createToken<AppDb>('app/Db')`.

### A database module without routes doesn't compile

TypeScript reports that `routes` is missing from the object `build()` returns.

**Fix.** A module that only registers the client still declares its routes — as none:

```ts
export const DbModule = defineModule({
  name: 'DbModule',
  build: () => ({
    register(container) {
      container.registerFactory(APP_DB, () => db)
    },
    routes: () => null,
  }),
})
```

## MySQL

### Dates are off by a few hours

**Why.** mysql2 reads and writes `TIMESTAMP` values in the Node process's time zone by default, so on a host that isn't on UTC every date shifts by the offset.

**Fix.** Pass `timezone: 'Z'` to `createPool`, in the app and in the CLI's `db.adapter()` — [Get started on MySQL](./get-started-mysql.md).

### Relational queries aren't supported

```text
MySQL 8.0+ required (detected: 5.7.42-log). JSON_ARRAYAGG (required by the relational query layer) shipped in MySQL 8.0 and MariaDB 10.5. Use layer-1/layer-2 queries (selectFrom / selectAll) on older versions.
```

The error's code is `KICK_DB_RELATIONAL_NOT_SUPPORTED`. Upgrade to MySQL 8.0 or MariaDB 10.5, or use the query builder instead of `db.query`.

## Queries

### `Duplicate value for …` answers `409`

```text
Duplicate value for users (email)
```

That's a `UniqueViolationError`: the row repeats a unique or primary key. Left unhandled it answers `409`, which is often what you want. To answer something else, catch it by class; to insert-or-update instead, use [`db.upsert()`](./queries.md#upsert-and-find-or-create), or `db.findOrCreate()` to reuse the existing row. [Errors](./errors.md) lists every typed error.

## FAQ

**Can I use kick/db without KickJS?**
Yes. `createDbClient`, the migration runner and the standalone `kickjs-db` binary don't need the framework — [Database CLI](./cli.md#standalone-kickjs-db). `kickDbAdapter` and DI tokens are the KickJS integration.

**Which database should I use?**
Postgres unless you have a reason not to; SQLite for local apps and tests; MySQL when your infrastructure already runs it — [Drivers](./drivers.md#choosing-a-dialect).

**Can I write raw SQL?**
Yes — `` sql`…` `` from `kysely`, executed with `.execute(db.qb)`, with values bound as parameters — [Raw SQL & Recipes](./raw-sql.md). In a migration, use `kick db generate <name> --empty` (and record the hash — [above](#hash-mismatch-for-migration)).

**How do I seed data?**
Put seed files in `db/seeds` and run [`kick db seed`](./cli.md#seed). Make them safe to run again with `db.upsert()` / `db.findOrCreate()`. Data a deploy depends on, that must run exactly once, belongs in a migration (`kick db generate <name> --empty`).

**Is there soft delete, or an `updatedAt` that updates itself?**
Yes: `.softDelete()`, `.onUpdateNow()` and `version()` — [columns kick/db maintains](./schema.md#columns-kick-db-maintains). Soft delete is honoured by relational reads; the plain query builder sees every row.

**Can I use several databases?**
Yes. Create a client per database and register each under its own [token](./index.md#_6-make-it-injectable) — `app/Db`, `app/Db/analytics`. Read replicas are an option on one client — [`replica`](./pooling.md#read-replicas).

**Can I edit a migration?**
Not once it has run anywhere: write a new one. Before that, yes — edit it, then review it; if it was already reviewed, reviewing again records the change ([above](#hash-mismatch-for-migration)).

**Can I squash old migrations?**
There's no squash command. A fresh database runs every migration in order, which stays fast for a long time. If you must, baseline as when [adopting an existing database](./adopting.md): introspect, start a new migration history, and mark it applied everywhere.

## Related

- [Database CLI](./cli.md)
- [Recovering from a failed migration](./migration-recovery.md)
- [CI and deploy](./ci-deploy.md)
- [Errors](./errors.md)
