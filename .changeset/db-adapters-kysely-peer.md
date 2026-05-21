---
'@forinda/kickjs-db-pg': patch
'@forinda/kickjs-db-mysql': patch
'@forinda/kickjs-db-sqlite': patch
---

deps: declare `kysely` as a peer dependency instead of a direct dependency

`@forinda/kickjs-db-pg`, `@forinda/kickjs-db-mysql`, and `@forinda/kickjs-db-sqlite` each used to declare `kysely: 0.29.2` as a direct `dependency`. `@forinda/kickjs-db` (which all three depend on as a peer) also declares the same exact version. With four separate exact pins, pnpm dedupes to a single copy today — but the moment one adapter bumps independently of the others, you get two copies of kysely in `node_modules`. Kysely is dialect-sensitive (the `PostgresDialect` / `MysqlDialect` / `SqliteDialect` classes carry module-augmented types) so two copies break `instanceof` checks and confuse downstream type inference.

Each adapter now declares `kysely: 0.29.2` as a `peerDependencies` entry pointing at the **same range** as `@forinda/kickjs-db`. The kickjs-db package keeps `kysely` as a `dependency` (it's the query-engine of that package, not a swappable choice). Adapters import `PostgresDialect`/`MysqlDialect`/`SqliteDialect` from kysely directly, so the peer declaration is required — without it, adopters using strict resolution wouldn't find kysely from the adapter's import path.

No version change for adopters: pnpm 8+ and npm 7+ auto-install peers, so the resolved tree is the same — except now there's a hard guarantee that the adapter and kickjs-db agree on the kysely version.
