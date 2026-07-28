---
'@forinda/kickjs-db': minor
---

feat: PostgreSQL named schemas via `pgSchema()`

Tables can now live in a named PG schema:

```ts
import { pgSchema } from '@forinda/kickjs-db/pg'

const billing = pgSchema('billing')
const invoices = billing.table('invoices', {
  id: serial().primaryKey(),
  ref: varchar(32).notNull(),
})
```

- Emits `CREATE SCHEMA IF NOT EXISTS "billing"` ahead of the tables that need it.
- Qualifies every generated statement — `CREATE`/`DROP`/`ALTER TABLE`, `CREATE INDEX`, `DROP INDEX` (whose name resolves through `search_path`), and any `REFERENCES` pointing at the table.
- Keys the row type as `KickDbSchema['billing.invoices']`, which Kysely reads as schema-qualified, so `db.selectFrom('billing.invoices')` resolves with no `withSchema()` call.
- Two schemas may hold same-named tables: snapshot keys are qualified, so `billing.events` and `audit.events` no longer collide.

`pgSchema('public')` collapses to "no schema" in both the runtime value and the type key — PG puts `public` on the default `search_path`, so treating it as a distinct key would make the diff emit `DROP TABLE users` + `CREATE TABLE public.users` for what is the same physical table.

Schemas are never dropped. There is no `dropSchema` change: a schema can hold objects this app never declared, so a `DROP SCHEMA` inferred from "nothing references it any more" could destroy data the diff never saw. Down migrations leave the emptied schema for an operator to remove.

PostgreSQL only — on MySQL a schema is a database and SQLite has none, so declaring one and diffing against those dialects throws at snapshot time, before any DDL is written.

Unqualified tables are completely unaffected: no `schema` field is written, no `schemas` array is added, and snapshots serialize byte-identically, so existing migration hashes stay valid.

Introspection is unchanged and still single-schema (`pgAdapter({ schema })`, default `public`) — tables in other schemas are created and migrated correctly but are not yet compared during drift detection.

Also fixes a latent bug this surfaced: `diffTable` stamped the bare table name onto every column/index/FK change instead of the snapshot key.
