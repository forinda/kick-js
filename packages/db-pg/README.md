# @forinda/kickjs-db-pg

> node-postgres adapter for [`@forinda/kickjs-db`](https://www.npmjs.com/package/@forinda/kickjs-db).

Wraps `pg.Pool` with the `MigrationAdapter` contract so `kick db migrate` can apply migrations and introspect against a real PostgreSQL database. Also provides the Kysely `PostgresDialect` factory for the query layer.

## Install

```bash
pnpm add @forinda/kickjs-db @forinda/kickjs-db-pg pg kysely
```

## Usage

```ts
import { Pool } from 'pg'
import { PostgresDialect } from 'kysely'
import { createDbClient, kickDbAdapter } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db-pg'
import { bootstrap } from '@forinda/kickjs'
import * as schema from './db/schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export const db = createDbClient({
  schema,
  dialect: new PostgresDialect({ pool }),
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

- [Schema Types](https://forinda.github.io/kick-js/guide/db-schema-types)
- [DB Extensions](https://forinda.github.io/kick-js/guide/db-extensions)

## License

MIT © Felix Orinda
