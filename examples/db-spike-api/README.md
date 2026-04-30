# db-spike-api

Smoke-test fixture for `@forinda/kickjs-db` M0 (the diff-engine spike).

This example does **not** boot a real KickJS application. It exists to prove
the `kick db generate` CLI surface works end-to-end:

1. `src/db/schema.ts` declares two tables (`users`, `posts`) with FK + indexes
   - a multi-column unique constraint, exercising every feature in M0.
2. `kick.config.ts` points the db tooling at the schema and a migrations
   output dir.
3. Running `pnpm db:generate init` walks the schema → `extractSnapshot` →
   `diff(empty, target)` → `emitPg` → writes `db/migrations/<ts>_init/`
   with `up.sql`, `snapshot.json`, and `meta.json`.

## Run

From this directory:

```bash
# Diff-based: walks the schema, emits up.sql + down.sql + snapshot.json.
pnpm db:generate init

# Empty shell: skip the diff, scaffold up.sql + down.sql you fill in.
# Use for seeds, data migrations, anything the diff engine can't author.
pnpm db:generate seed_default_users -- --empty
```

First diff-based run creates `db/migrations/<timestamp>_init/`. Re-running
with no schema change prints `No schema changes detected.` and exits 0.

`--empty` always creates a new migration regardless of schema state — the
shell pre-loads `-- REVIEWED: false` markers and a hint comment so you
fill in your SQL and flip the marker before applying.

`meta.json` chains migrations via `previousId` (the prior migration's id,
`null` on the first), and records `empty: true|false` and `downIsDraft`
(true when the forward changes have ambiguous reverses — drop column,
drop table, type change).

## What's intentionally missing

This is **M0 only**. The example does NOT include:

- Down-migration emission (`down.sql`) — M1.
- A migration runner that applies `up.sql` against a live database — M1.
- A `KickDbClient` query builder — M1.
- Any HTTP routes / controllers — wired in once M1 lands the client.

For the full architecture, see [`../../docs/db/architecture.md`](../../docs/db/architecture.md).
For the milestone breakdown, see [`../../docs/db/m0-spike-plan.md`](../../docs/db/m0-spike-plan.md).
