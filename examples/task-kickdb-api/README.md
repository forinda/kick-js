# task-kickdb-api

End-to-end example of [`@forinda/kickjs-db`](../../packages/db) running on
real Postgres. Three tables (users, workspaces, tasks) — a representative
subset of [`examples/task-prisma-api`](../task-prisma-api) ported to the
KickJS-native ORM. Exercises every M1 surface:

- Code-first schema in `src/db/schema.ts` (uuid, varchar, text, boolean,
  timestamp, jsonb, integer, FK with CASCADE, single + multi-column unique,
  named indexes, `relations()`).
- Migration generation: `kick db generate <name>` walks the schema, writes
  reversible up.sql + down.sql + snapshot.json under `db/migrations/`.
- Migration runner: `kick db migrate latest|up|down|rollback|status`.
- `kickDbAdapter()` registered in `bootstrap()` with `migrationsOnBoot:
'apply'` in dev (so HMR-driven schema iteration is ergonomic) and
  `'fail-if-pending'` in prod (operator must explicitly `kick db migrate
latest` before deploys).
- `KickDbClient` injected into repositories via `@Inject(DB_PRIMARY)`.

## Run

```bash
# 1. Postgres up
docker run --rm -d --name kickdb-pg \
  -e POSTGRES_PASSWORD=dev -p 5432:5432 \
  postgres:16-alpine

export DATABASE_URL="postgres://postgres:dev@localhost:5432/postgres"

# 2. Generate the initial migration
pnpm db:generate init

# 3. Review the up.sql + down.sql, flip meta.json `reviewed: true`,
#    then apply
pnpm db:migrate

# 4. Status
pnpm db:status

# 5. Boot the API
pnpm dev
```

## Endpoints

| Method | Path                   | Notes                                 |
| ------ | ---------------------- | ------------------------------------- |
| POST   | `/users`               | Create a user                         |
| GET    | `/users`               | List all users                        |
| GET    | `/users/:id`           | Show one user                         |
| POST   | `/workspaces`          | Create a workspace (requires ownerId) |
| GET    | `/workspaces`          | List all workspaces                   |
| GET    | `/workspaces/:id`      | Show one workspace                    |
| POST   | `/tasks`               | Create a task in a workspace          |
| GET    | `/tasks?workspaceId=…` | List tasks for a workspace            |
| PATCH  | `/tasks/:id/status`    | Update task status                    |

## Notable implementation details

- `src/db/client.ts` constructs a single `pg.Pool` shared by both the
  Kysely query layer (`KickDbClient` under `DB_PRIMARY`) and the
  migration adapter (`pgAdapter`). The pool is caller-owned — both the
  CLI and the runtime pass it to `pgAdapter`, which is a no-op on
  `close()`. The bootstrap entry drains the pool on `SIGTERM`/`SIGINT`.
- Repositories cast the typed `KickDbClient` once via a `Db` alias,
  then call Kysely's standard `selectFrom().selectAll().execute()`. The
  M1-permissive `unknown` per-column type means inserts need a single
  `as never` cast at the value boundary; M2-S1 tightens this through
  column-builder phantom generics so the cast goes away.
- `task-prisma-api`'s 14-table schema has been distilled to 3 tables
  here. The full port lands in a follow-up issue once M2 ships the
  precise type inference and `db.query.X.findMany({ with })` API.
