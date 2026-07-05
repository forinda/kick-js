# @forinda/kickjs-db-pg

> ⚠️ **Deprecated — merged into [`@forinda/kickjs-db`](https://www.npmjs.com/package/@forinda/kickjs-db).**
> This package is now a thin re-export shim kept for one release. Install only
> `@forinda/kickjs-db` (plus the `pg` driver) and import from the `/pg` subpath:
> `import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'`. Importing from
> this package logs a runtime deprecation warning. It will stop being published
> in a future release.

> PostgreSQL adapter for [`@forinda/kickjs-db`](https://www.npmjs.com/package/@forinda/kickjs-db).

Two factories:

- **`pgDialect({ pool })`** — query-layer dialect for `createDbClient({ dialect })`.
- **`pgAdapter({ pool })`** — `MigrationAdapter` for `kick db migrate` + `kickDbAdapter` boot-time apply.

Both consume a pg-protocol-compatible pool (`pg.Pool`, `@neondatabase/serverless`'s `Pool`, etc.) — adopters pick whichever runtime fits.

## Install

```bash
pnpm add @forinda/kickjs-db @forinda/kickjs-db-pg pg
```

## Usage

```ts
import { Pool } from 'pg'
import { createDbClient, kickDbAdapter } from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db-pg'
import { bootstrap } from '@forinda/kickjs'
import * as schema from './db/schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  events: true,
})

const migrationAdapter = pgAdapter({ pool })

export const app = await bootstrap({
  modules,
  adapters: [
    kickDbAdapter({
      migrationAdapter,
      migrationsDir: 'db/migrations',
      migrationsOnBoot: process.env.NODE_ENV === 'development' ? 'apply' : 'fail-if-pending',
    }),
  ],
})
```

The `pool` is shared between the migration adapter (used by the CLI for `kick db migrate latest` and similar) and the query client (used by repositories). One pool, no duplicate connections.

## Docs

- [Schema Types](https://kickjs.app/guide/db-schema-types)
- [DB Extensions](https://kickjs.app/guide/db-extensions)

## License

MIT © Felix Orinda
