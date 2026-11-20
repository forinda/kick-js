---
'@forinda/kickjs-testing': minor
'@forinda/kickjs-db': minor
---

Shared, named, reusable test services, with a database per test file on them.

- **`@forinda/kickjs-testing`**
  - `kickTestServices({ postgres: { name: 'myapp-test-pg' } })` is a Vitest `globalSetup`. It starts each service once per run and hands its URL to every file (`inject('postgres')`, `KICK_TEST_POSTGRES_URL`).
  - A named service is reused by the next local run instead of starting another, so a machine keeps one container per name. CI starts fresh.
  - `startService` / `startContainer` take `{ name, reuse, env, command, tmpfs, hostPort }`.
  - A new `mysql` preset.
  - `kick test:services ls|down` (`testServicesCliPlugin`) lists and removes test containers.
  - The Postgres and MySQL presets now keep data in memory with fsync off.
- **`@forinda/kickjs-db`**
  - `createPgTestDb` copies a template database migrated once, makes an empty database when given no schema, reads `KICK_TEST_POSTGRES_URL`, refuses a server whose database name lacks `test` (`allowNonTestDatabase` overrides), and sweeps old leftovers.
  - New `createMysqlTestDb`.
  - New `useTestDb()` from `@forinda/kickjs-db/testing/vitest`.

**Behaviour change:** `createPgTestDb` now refuses a server URL whose database name doesn't contain `test`. A CI service URL like `postgres://…/postgres` throws until you point it at a `test` database, or pass `allowNonTestDatabase: true`.
