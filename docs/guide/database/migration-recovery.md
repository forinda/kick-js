---
description: Recover from migration problems in kick/db — rolling back, a migration that failed half-way, hash mismatches, unreviewed migrations, drift, a stuck lock, enum value removal, and two branches that each added a migration.
---

# When a Migration Goes Wrong

Every error the runner throws stops it before it changes anything it can't account for. This page goes from the message you see to the fix.

| You see                                                                        | Go to                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| You want the last migration undone                                             | [Undo a migration](#undo-a-migration)                        |
| `Migration <id> failed: …` — a database error mid-migration                    | [A migration failed half-way](#a-migration-failed-half-way)  |
| `Hash mismatch for migration <id>`                                             | [Hash mismatch](#hash-mismatch)                              |
| `Migration <id> is unreviewed (meta.json reviewed: false) …`                   | [Unreviewed migration](#unreviewed-migration)                |
| `Schema drift detected: 1 added, 0 removed, 0 changed`                         | [Drift](#drift)                                              |
| `Another process holds the migration lock …`                                   | [A stuck lock](#a-stuck-lock)                                |
| `Migration <id> drops value(s) … from PostgreSQL enum(s) …`                    | [Removing an enum value](#removing-an-enum-value)            |
| `kick db check` says the schema has changes no migration covers, after a merge | [Two branches, two migrations](#two-branches-two-migrations) |

`kick db migrate status` is the first thing to run in all of them: it lists every migration, applied or pending, and whether it's reviewed. The [error reference](./errors.md#migrations) has every migration error's class and `code`.

## Undo a migration

<PmCommand exec="kick db migrate down" />

reverses the most recently applied migration by running its `down.sql`.

<PmCommand exec="kick db migrate rollback" />

reverses the whole last batch — everything one `migrate latest` applied — newest first:

```text
Rolled back batch 4: 20261002_180107_drop_name
```

The migration goes back to pending; fix it or delete it, then apply again.

A `down.sql` can only restore structure, not data. When a migration drops a column, drops a table or changes a type, `generate` marks its reverse as a draft — the first line of `down.sql` says so, and `meta.json` has `"downIsDraft": true`:

```sql
-- DRAFT: ambiguous reverses present (drop column / drop table / type change). Audit before applying.
ALTER TABLE "users" ADD COLUMN "name" TEXT;
```

Rolling that back gives you the `name` column again, empty. The runner doesn't refuse a draft — read it when you review the migration, and in production prefer a fix-forward migration to a rollback ([CI and Deployment](./ci-deploy.md#when-a-deploy-goes-wrong)).

## A migration failed half-way

Each migration runs in its own transaction, so what's left after a failure depends on whether the database can roll back DDL:

| Dialect    | After a statement fails                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | everything the migration did is rolled back                                                                                  |
| SQLite     | everything the migration did is rolled back                                                                                  |
| MySQL      | statements before the failure stay — `CREATE`, `ALTER` and `DROP` commit as they run, and a transaction can't take them back |

In every case the migration stays **pending** and the lock is released. Migrations that ran earlier in the same `migrate latest` stay applied — only the failing one is undone.

The error names the migration and carries the database's own message:

```text
Migration 20261002_180801_fix_data failed: relation "missing_table" does not exist
```

From code it's a `MigrationFailedError` with the migration's `id`, and the driver's error as `cause`.

To recover:

1. **MySQL only:** undo what the failed migration did before it stopped. If it created a table, drop it. Otherwise the next run stops at [drift](#drift) — the live database now has something no applied migration describes — and a retry would fail on "already exists".
2. Fix the migration. A pending migration is still yours to change — see [Changing a migration before it's applied](#changing-a-migration-before-it-s-applied).
3. Run `kick db migrate latest` again.

::: tip Keep MySQL migrations small
Since a MySQL migration can stop half-way, one change per migration means a failure leaves at most one thing to undo by hand.
:::

### Changing a migration before it's applied

Until it's reviewed, a migration is a draft: edit `up.sql` and `down.sql` freely — fill in an `--empty` migration, add a backfill to a generated one, fix the statement that failed. Reviewing records the hash of the files as you approved them, and from then on the runner refuses them if they change ([Hash mismatch](#hash-mismatch)).

- **Not reviewed yet** — edit, read it through, then `kick db migrate review <id>`.
- **Reviewed, not applied anywhere** — edit, then `kick db migrate review <id>` again; running it again records the new hash.
- **The schema itself was wrong** — for a generated migration, delete its folder and its entry in `db/migrations/_journal.json`, fix `schema.ts`, and `kick db generate <name>` again.

A migration that's already applied somewhere is no longer yours to change: that database ran the old SQL. Put the change in a new migration.

## Hash mismatch

```text
Hash mismatch for migration 20261002_180801_fix_data
```

A migration's files changed after it was reviewed. If it's still pending everywhere, read the change and `kick db migrate review <id>` again. If it's applied somewhere, the edit can't take effect there — undo it (`git checkout db/migrations/<id>`) and put the change in a new migration.

The runner checks only pending migrations, so an edit to an applied one goes unnoticed by `migrate latest`. `kick db check` reports both cases, so run it in CI ([CI and Deployment](./ci-deploy.md)):

```text
20261002_180801_fix_data was edited after it was reviewed — review it again, or revert the edit.
```

## Unreviewed migration

```text
Migration 20261002_175758_init is unreviewed (meta.json reviewed: false) — run `kick db migrate review 20261002_175758_init` before applying outside dev
```

Outside `NODE_ENV=development` the runner applies only migrations someone marked reviewed. Read `up.sql` and `down.sql`, then:

<PmCommand exec="kick db migrate review 20261002_175758_init" />

`review` marks it reviewed in `meta.json` and records the hash of the files as you read them in `_journal.json`; commit both with the migration. In development unreviewed migrations apply as they stand, so you can iterate on one. `kick db` reads your `.env`, so locally — where the scaffold sets `NODE_ENV=development` — that's the default; a CI runner or server without that `.env` enforces the gate.

## Drift

```text
Schema drift detected: 1 added, 0 removed, 0 changed (added: users.nickname)
```

Before applying anything, `migrate latest` and `migrate up` compare the live database with the snapshot of the last applied migration. A difference means the database was changed outside the migrations — a column added from a console, an index created by hand, a migration that failed half-way on MySQL. The runner stops, because the next migration was generated for the schema it expects, not the one that's there.

The message names what differs; from code, `err.diff` has the same `added` / `removed` / `changed` lists. [`kick db introspect --json`](./cli.md) prints the whole live schema to compare with the latest `snapshot.json`. Then decide:

- **The change shouldn't be there** — undo it by hand (`ALTER TABLE users DROP COLUMN nickname`). The next run passes.
- **The change should stay** — add it to `schema.ts` and `kick db generate <name>`. On databases that don't have it yet the migration adds it. On the database that already has it, the migration would fail on "already exists", so record it there as applied without running it — the baseline script in [Adopting kick/db](./adopting.md#_3-baseline-the-migration-history) does exactly that.

`driftCheck` relaxes the check, in `kick.config.ts` (`db.driftCheck`) for the CLI and in `kickDbAdapter({ driftCheck })` for boot-time applies:

| `driftCheck`        | On drift                        |
| ------------------- | ------------------------------- |
| `'error'` (default) | stop with `MigrationDriftError` |
| `'warn'`            | log the summary and continue    |
| `'ignore'`          | don't introspect at all         |

Use `'warn'` while you reconcile, not as a permanent setting: the check is what tells you the next migration might not apply.

## A stuck lock

```text
Another process holds the migration lock. If none is running — a deploy was killed mid-migration — release it with `kick db migrate unlock`.
```

A run takes a lock in the database so two deploys can't migrate at once; it releases it when it finishes or fails. A run that was killed — out of memory, `SIGKILL`, a cancelled CI job — can't, and every later run stops here. Check nothing is migrating, then:

<PmCommand exec="kick db migrate unlock" />

```text
Released the migration lock.
```

A second run is refused immediately rather than waiting for the lock, so this error also appears when two instances try to migrate at the same moment — which is why migrations belong in one release step, not in every instance's boot ([CI and Deployment](./ci-deploy.md#several-instances)).

## Removing an enum value

```text
Migration 20261002_180355_drop_blocked drops value(s) blocked from PostgreSQL enum(s) "task_status". Re-run with `--confirm-enum-drop` (CLI) or `confirmEnumDrop: true` (RunnerOptions) after reviewing the column-USING clauses in up.sql.
```

Postgres can't remove a value from an enum, so the migration recreates the type and converts every column that uses it. A row still holding the removed value makes that conversion fail, so the runner asks you to confirm. Read the `USING` clauses in `up.sql`, update or delete rows that hold the value, then:

<PmCommand exec="kick db migrate latest --confirm-enum-drop" />

[Migrations → Enum value removal](./migrations.md#enum-value-removal) covers how the SQL is built.

## Two branches, two migrations

Two branches each change the schema and each generate a migration on top of the same parent. Git merges the migration folders cleanly and conflicts only in `_journal.json`, where both appended an entry. Keeping both entries resolves the conflict — and leaves a problem:

- each migration's `snapshot.json` describes its own branch's schema, so the latest one (by timestamp) doesn't know about the other branch's change;
- after both apply, the next `kick db generate` diffs against that incomplete snapshot and repeats the other branch's change — `ALTER TABLE "users" ADD COLUMN "bio"` a second time;
- and `migrate latest` stops at [drift](#drift), because the live database has a column the last snapshot doesn't.

`kick db check` catches it on the merged branch, before anything is applied:

```text
The schema has 1 change no migration covers — run `kick db generate <name>`.
```

Fix it on the merged branch by regenerating the later migration on top of the earlier one:

1. If the later migration is applied to your local database, `kick db migrate down` to reverse it.
2. Delete its folder and its entry in `_journal.json`.
3. `kick db generate <same name>`. The new migration diffs against the earlier branch's snapshot, so it contains only the later branch's change, and its snapshot has both.
4. `kick db migrate review <id>`, `kick db migrate latest`, and `kick db check` passes.

Do this before the merge reaches a shared environment. Running `kick db check` in CI on every pull request makes sure it does ([CI and Deployment](./ci-deploy.md)).

## Related

- [Migrations](./migrations.md) — generating, reviewing, applying, boot policy
- [CI and Deployment](./ci-deploy.md) — where these checks belong
- [Database CLI](./cli.md) — every `kick db` command
- [Troubleshooting](./troubleshooting.md)
