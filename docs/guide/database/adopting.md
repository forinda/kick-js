# Adopting kick/db on an Existing Database

The [getting started](./index) path assumes an empty database: you write a schema, generate a migration, apply it. Adopting `@forinda/kickjs-db` on a database that already exists — with data, and usually with another ORM's migration history — is a different job.

The order matters. Introspect first, baseline second, and only then let the differ near your database.

## The one thing that will bite you

`kick db generate` diffs your schema against the **last snapshot it wrote**, not against the live database. With no snapshot, every table you have is "new", so the generated `up.sql` is full of `CREATE TABLE` statements for tables that already exist. Running it fails — and if it half-succeeds you have a real mess.

So the first migration on an existing database is never applied. It is **recorded as already applied**, which is what "baselining" means below.

## 1. Introspect the live database

Point the CLI at the database and let it write the schema for you:

```bash
kick db introspect
```

That reads the live schema and writes TypeScript to `db.schemaPath` (`--out` to send it elsewhere, `--json` to inspect the raw snapshot without writing anything). The migration tracking tables (`kick_migrations`, `kick_migrations_lock`) are excluded automatically, as is anything your old ORM keeps — check for its journal table (`_prisma_migrations`, `knex_migrations`, `typeorm_metadata`) and exclude it from the schema file if it came through.

## 2. Read what it produced

Introspection recovers what the database knows, which is less than what you know. Expect to fix up:

- **Names.** Column and table names come back exactly as they are in SQL. If your old ORM mapped `created_at` to `createdAt`, that mapping lived in the ORM, not the database.
- **Enums.** Postgres enums come through; a `varchar` with a `CHECK` constraint, or an int-backed enum, comes back as its storage type.
- **Defaults.** A default expression the differ cannot represent is dropped with a comment rather than guessed at.
- **Relations.** Foreign keys are recovered; the `relations()` declarations that drive `db.query` are not — the database has no idea you call them "author's posts". Add those by hand ([Schema](./schema#relations)).

Do this now rather than later: everything below treats this file as the truth.

## 3. Baseline the migration history

Generate a migration that describes the schema as it stands:

```bash
kick db generate baseline
```

Now record it as applied **without running its SQL**. There is no `--fake` flag; `recordApplied()` on the migration adapter is the supported way, and a ten-line script is clearer than a flag would be about what it does:

```ts
// scripts/baseline.ts — run once, then delete it
import { computeMigrationHash, readJournal } from '@forinda/kickjs-db'
import { migrationAdapter } from '../src/db/client'

const migrationsDir = 'db/migrations'
const journal = await readJournal(migrationsDir, migrationAdapter.dialect)
const entry = journal.entries.at(-1)
if (!entry) throw new Error('No migration to baseline — run `kick db generate baseline` first.')

await migrationAdapter.ensureMigrationTables()
await migrationAdapter.recordApplied({
  id: entry.id,
  name: entry.tag,
  hash: await computeMigrationHash(`${migrationsDir}/${entry.id}`),
  batch: 1,
  direction: 'up',
})
await migrationAdapter.close()
console.log(`Baselined ${entry.id} — its SQL was NOT executed.`)
```

Confirm it took:

```bash
kick db migrate status   # baseline: applied, nothing pending
```

From here the normal loop works: edit the schema, `kick db generate <name>`, read the SQL, `kick db migrate latest`. The second migration is a real diff against the baseline snapshot, so it contains only your actual change.

::: warning Baseline against every environment
The tracking table lives in the database, so each environment needs the row. Run the script once per environment (dev, staging, production) before the first real migration reaches it — otherwise production sees the baseline as pending and, under `migrationsOnBoot: 'fail-if-pending'`, refuses to boot.
:::

## 4. Verify the schema really matches

After editing the introspected file you want one question answered: does it still describe the live database? `migrate status` does not answer it — that lists applied and pending migrations only. Compare the snapshot directly:

```bash
kick db introspect --json > /tmp/live.json
diff <(jq -S . /tmp/live.json) <(jq -S . db/migrations/<baseline-id>/snapshot.json)
```

An empty diff means the baseline snapshot and the database agree, so the next `kick db generate` will produce a diff of your change and nothing else. A non-empty diff is usually step 2 edited a little too enthusiastically — fix the schema file rather than generating SQL to change a database that is already correct.

Drift detection covers this from then on, but it runs when migrations are **applied** (`migrate latest` / `up`), not on `status`. Configure it in the `db` block:

```ts
db: {
  driftCheck: 'error', // 'error' | 'warn' | 'ignore'
}
```

## Running alongside your current ORM

You do not have to cut over in one commit. Two clients can read and write the same database — they are just connections.

What you cannot do is let both own the schema. Pick one migration tool from the day you baseline:

| Concern            | During transition                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Migrations         | **One owner.** Freeze the old ORM's migrations; all schema changes go through `kick db generate`. |
| Reads/writes       | Both, freely. Migrate module by module.                                                           |
| Connection pooling | Two pools means two limits. Halve each, or share a pool if the drivers allow.                     |
| Transactions       | A transaction cannot span both clients. Keep a unit of work inside one of them.                   |

The reason for the first row: if both tools write their own journal tables, each will happily generate a migration that undoes the other's change, and neither has any idea the other exists.

## Cutover checklist

- [ ] `kick db introspect` output reviewed, names and enums corrected, `relations()` added
- [ ] Baseline generated and recorded in **every** environment
- [ ] `kick db migrate status` clean, no drift
- [ ] Old ORM's migration tool frozen — schema changes go through one tool only
- [ ] One real migration generated and applied end to end, in a non-production environment first
- [ ] Old ORM's journal table left alone until you are certain (it is small; dropping it is not urgent)

## Coming from a specific ORM

The mechanics above are the same regardless; these are the mapping notes that catch people out.

**Prisma.** `schema.prisma` names are the ORM's, not the database's — `@map`/`@@map` mean your introspected names may differ from the model names you are used to. Prisma's `_prisma_migrations` table is unrelated to `kick_migrations`; leave it until cutover is done.

**Drizzle.** Closest in shape — both are code-first, both build on a query builder — so schema translation is mostly mechanical. Drizzle's `drizzle-kit` snapshots are not interchangeable with kick/db snapshots, so baseline rather than trying to convert history.

**TypeORM / Sequelize.** Entity decorators and model definitions carry behaviour (hooks, cascades, lifecycle events) that has no schema equivalent. Introspection recovers the tables; the behaviour is application code you port to services or [context contributors](../context-decorators).

**Knex / raw SQL.** The easiest case: there are no ORM semantics to unwind. Introspect, baseline, and keep your existing query code running while you move call sites onto the typed client at whatever pace suits.

## See also

- [Database CLI](./cli) — every `kick db` command, including `introspect` flags
- [Migrations](./migrations) — the review gate, batches, rollback, drift detection
- [Schema](./schema) — the builders you will be editing in step 2
- [Repositories](./repositories) — a useful seam while two clients coexist
