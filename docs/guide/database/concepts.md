# How kick/db Works

kick/db has one source of truth — the schema you write in TypeScript — and derives everything else from it: the migrations that shape the database, and the types that check every query. Knowing how the pieces connect makes the rest of these docs, and most error messages, easier to read.

```text
schema.ts ──extract──▶ snapshot ──diff──▶ changes ──emit──▶ up.sql / down.sql ──review──▶ migrate ──▶ database
    │                                        ▲
    │                     previous migration's snapshot.json
    │
    └──infer──▶ row types ──▶ typed client (query builder, db.query, transactions)
```

## The schema

You declare tables with `table()` (or a [class or fluent form](../db-table-forms)): columns, keys, constraints, indexes, and `relations()` between tables. That file is ordinary TypeScript — no separate schema language, no generate step before the types work.

## The snapshot

`extractSnapshot(schema, dialect)` turns the schema into a **snapshot**: plain JSON describing every table, column, index, foreign key, CHECK and enum, as the database will see it. It's the common language of the migration side — what gets diffed, written into each migration, and compared against a live database. Because it's data, not code, two snapshots can be compared exactly.

## Changes and SQL

`kick db generate <name>` diffs your current schema's snapshot against the **previous migration's** `snapshot.json` — the state your migrations already describe, not the live database. The diff is a list of changes (`createTable`, `addColumn`, `alterPrimaryKey`, `addCheck`, …), each emitted as SQL for your dialect:

- Postgres and MySQL get `ALTER` statements.
- SQLite, which can't alter most things in place, gets a table rebuild: create the new table, copy the rows, swap it in, and check foreign keys before committing.

The same changes, inverted, become `down.sql`. A migration folder holds `up.sql`, `down.sql`, the new `snapshot.json`, and `meta.json` (name, review state), and `_journal.json` records each migration with a hash of its files.

## Review and apply

Generated SQL is a draft until someone reads it. `meta.json` starts `reviewed: false`, and outside development the runner refuses unreviewed migrations — `kick db migrate review <id>` marks one read. Before applying, the runner:

1. takes a lock, so two deploys can't migrate at once;
2. checks every migration's hash against the journal, so an edited migration is caught;
3. introspects the database and compares it with the last applied snapshot (**drift**), so a hand-made change is caught — on by default, `driftCheck: 'warn' | 'ignore'` to relax it.

Each run applies the pending migrations as one **batch**, which `rollback` reverses together. [Migrations](./migrations) covers the commands.

## The typed client

The same schema feeds the client. `createDbClient({ schema, dialect })` infers each table's row type from the column builders — `varchar().notNull()` is `string`, a nullable `timestamp()` is `Date | null` — so the query builder, the relational `db.query` layer and inserts are checked against your columns with no code generation. When the client is injected by token across files, `KickDbRegister` carries the types; [Schema Types](../db-schema-types) explains it.

The client is [Kysely](https://kysely.dev) underneath, wrapped with:

- **relational reads** — `db.query.users.findMany({ with: { posts: true } })`, compiled to one query from your `relations()`;
- **transactions that follow the call chain** — code holding the plain client joins the transaction its caller opened;
- **typed errors** — driver failures become `UniqueViolationError` and friends;
- **events and plugins** — observe every query, rewrite queries before they run.

## What lives where

| You write   | kick/db derives                   | Stored in                                        |
| ----------- | --------------------------------- | ------------------------------------------------ |
| `schema.ts` | snapshot                          | each migration's `snapshot.json`                 |
| —           | the change list                   | `up.sql` / `down.sql`                            |
| review      | —                                 | `meta.json`                                      |
| —           | integrity hashes, order           | `_journal.json`                                  |
| —           | applied migrations, batches, lock | `kick_migrations`, `kick_migrations_lock` tables |
| —           | row types                         | nothing — inferred by TypeScript                 |

## Related

- [Getting started](./) — the whole flow, end to end
- [Schema](./schema), [Keys and Constraints](./constraints)
- [Migrations](./migrations)
- [Queries](./queries), [Transactions](./transactions)
