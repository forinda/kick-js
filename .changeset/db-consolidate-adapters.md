---
'@forinda/kickjs-db': minor
'@forinda/kickjs-db-pg': minor
'@forinda/kickjs-db-sqlite': minor
'@forinda/kickjs-db-mysql': minor
'@forinda/kickjs-cli': patch
---

Consolidate the SQL dialect adapters into `@forinda/kickjs-db` subpaths.

The PostgreSQL / SQLite / MySQL adapters + dialects now ship from **subpaths of `@forinda/kickjs-db`** instead of separate packages — mirroring how `@forinda/kickjs-schema` exposes `./zod` / `./valibot` / `./yup`. Install one package plus the single driver you use:

```bash
# before
pnpm add @forinda/kickjs-db @forinda/kickjs-db-pg pg
# after
pnpm add @forinda/kickjs-db pg
```

```ts
// before
import { pgAdapter, pgDialect } from '@forinda/kickjs-db-pg'
// after
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'
```

- New subpaths: `@forinda/kickjs-db/pg` (now also carries `pgAdapter` + `pgDialect` alongside the PG column types), `@forinda/kickjs-db/sqlite`, `@forinda/kickjs-db/mysql`.
- `pg`, `better-sqlite3`, `mysql2` are **optional peer deps** of `@forinda/kickjs-db` — the relevant subpath imports its driver lazily, so the core install never pulls all three.
- `@forinda/kickjs-db-pg` / `-sqlite` / `-mysql` remain as **deprecated re-export shims** (`export * from '@forinda/kickjs-db/<dialect>'`) so existing installs keep working; they'll be removed in a future major.
- CLI: `kick db` resolves the pg adapter from `@forinda/kickjs-db/pg`; `kick add pg|sqlite|mysql` installs `@forinda/kickjs-db` plus the matching driver.
