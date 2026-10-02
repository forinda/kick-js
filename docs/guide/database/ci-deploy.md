---
description: Run kick/db migrations safely in CI and production — kick db check on every pull request, migrations as a release step, a boot that refuses pending migrations, several instances, zero-downtime changes, and what to do when a deploy goes wrong.
---

# Migrations in CI and Deployment

Locally, `kick dev` applies pending migrations as the app boots. Everywhere else, two rules keep migrations predictable:

1. **CI proves a migration is ready** — generated, reviewed, unedited — before it merges.
2. **A deploy applies migrations once, as its own step**, before the new version starts. The app itself only checks.

## In CI

`kick db check` fails when something would stop `migrate latest` later:

- the schema has changes no migration covers — someone edited `schema.ts` and forgot `kick db generate`, or [two branches each added a migration](./migration-recovery.md#two-branches-two-migrations);
- a migration isn't reviewed;
- a migration was edited after it was reviewed.

```text
The schema has 1 change no migration covers — run `kick db generate <name>`.
20261002_175758_init is not reviewed — read it, then `kick db migrate review 20261002_175758_init`.
```

It reads only your files, so it needs no database and runs in seconds. Run it on every pull request, next to the tests:

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Migrations match the schema
        run: pnpm exec kick db check
      - name: Tests
        run: |
          cp .env.test.example .env.test
          pnpm test
```

`.env.test` is git-ignored, so CI makes it from the committed `.env.test.example`. Tests that build an in-memory SQLite database from `schema.ts` ([Database Testing](./testing.md)) need nothing else.

### Applying the migrations for real

`kick db check` proves the files are consistent, not that the SQL runs. To prove that too, apply every migration to a throwaway database of your production dialect:

```yaml
jobs:
  migrate:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Apply every migration to an empty database
        run: pnpm exec kick db migrate latest
```

The runner has no `.env` to read here, so `NODE_ENV` isn't `development` and the review gate applies, as it will in production.

## Deploying

### Migrate, then start

Apply migrations once per deploy, after the new code is built and before any instance of it starts:

```bash
NODE_ENV=production DATABASE_URL=… kick db migrate latest
```

```text
Applied batch 3: 20261002_180055_add_posts
```

Where that runs depends on your platform — a step in your deploy script or pipeline, a release phase, a one-off job before the rollout. It needs the project's `kick.config.ts` and dev dependencies (`kick` is the `@forinda/kickjs-cli` dev dependency), so run it from your CI job or a release image that has them, not from the slim production image.

Set `NODE_ENV=production` explicitly: `kick db` reads `.env`, and if one on the deploy machine says `development`, the review gate is off. With it set, the runner:

1. takes the migration lock;
2. refuses any pending migration that isn't reviewed, or whose files changed since it was reviewed;
3. compares the live database with the last applied snapshot and stops on [drift](./migration-recovery.md#drift);
4. applies the pending migrations as one batch, each in its own transaction.

Any failure exits non-zero, so the pipeline stops before the new version starts.

### The app refuses to start behind the database

The scaffolded `src/index.ts` sets the boot policy:

```ts
kickDbAdapter({
  migrationAdapter,
  migrationsDir: 'db/migrations',
  migrationsOnBoot: process.env.NODE_ENV === 'development' ? 'apply' : 'fail-if-pending',
})
```

Outside development, an app started while a migration is pending refuses to boot and exits with code 1:

```text
ERROR [Process] Uncaught exception Error: kickjs-db: 1 pending migration(s); run `kick db migrate latest` before boot
```

That's the safety net for a skipped migration step: the new version never serves requests against the old schema, and your platform sees a failed start instead of a healthy one. [Migrations → Boot-time policy](./migrations.md#boot-time-policy) has the other options.

### Several instances

Don't use `migrationsOnBoot: 'apply'` when more than one instance starts at once. The migration lock lets one run migrate; the others don't wait for it — they fail with `Another process holds the migration lock` and, since a boot-time failure stops the app, those instances don't start. A single release step avoids the race, and `fail-if-pending` on every instance is safe to run in parallel.

If a migration step is killed while holding the lock, the next deploy stops on that message; release it with `kick db migrate unlock` once you're sure nothing is migrating ([A stuck lock](./migration-recovery.md#a-stuck-lock)).

## Changes without downtime

During a rolling deploy the old version keeps serving while the new one starts, so for a while both run against the migrated database. A migration that removes or renames something the old version still uses breaks it for that window. Split such changes across two deploys — first add, then remove:

**Renaming a column** (`name` → `displayName`):

1. Deploy 1 — a migration adds `displayName`; the code writes both columns and reads `displayName`, falling back to `name`. Backfill existing rows in a migration or a job.
2. Deploy 2 — once nothing runs deploy-1-or-older code, the code stops using `name` and a migration drops it.

**Dropping a column or table:** deploy the code that stops using it first; drop it in the next deploy.

**Adding a `NOT NULL` column:** add it nullable or with a default, backfill, then tighten it in a later migration.

Adding a table, a nullable column or an index is safe in one step. On a large Postgres table, declare it with `.concurrently()`: `kick db generate` builds it with `CREATE INDEX CONCURRENTLY` in a migration of its own that runs outside a transaction, so writes aren't blocked while it builds — [Partial, expression and other indexes](./constraints.md#partial-expression-and-other-indexes).

## When a deploy goes wrong

**Prefer fixing forward.** If a migration applied but the release is broken, ship a new migration that corrects it. `kick db migrate rollback` runs the batch's `down.sql` files, and a down for a dropped column or table can bring back the structure but not the data — `generate` marks those as drafts for that reason ([Undo a migration](./migration-recovery.md#undo-a-migration)).

**Roll back only what's safe to roll back:** a migration that added things nothing has written to yet. Roll back the code first if it depends on the new schema.

**If the migration step itself failed,** nothing new started: the old version keeps serving. On Postgres and SQLite the failed migration was rolled back; on MySQL part of it may have applied. [A migration failed half-way](./migration-recovery.md#a-migration-failed-half-way) walks through both.

**Take a backup before destructive migrations** — anything that drops a column, a table or an enum value — with your database's own tools (`pg_dump`, `mysqldump`, a managed provider's snapshot). A `down.sql` is not a backup.

## Related

- [When a Migration Goes Wrong](./migration-recovery.md)
- [Migrations](./migrations.md) — generating, reviewing, boot policy
- [Database CLI](./cli.md)
- [Database Testing](./testing.md)
- [Pooling](./pooling.md)
