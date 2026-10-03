# @forinda/kickjs-db

kick/db, the KickJS database layer: a code-first schema, fully typed queries, and migrations generated from schema changes. Works with PostgreSQL, MySQL and SQLite.

## Install

```bash
kick add db        # or: pnpm add @forinda/kickjs-db pg
```

Dialects ship as subpaths: `@forinda/kickjs-db/pg` (driver `pg`), `/mysql` (`mysql2`) and `/sqlite` (`better-sqlite3`).

## Quick example

```ts
import { createDbClient, table, timestamp, uuid, varchar } from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'
import { Pool } from 'pg'

const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  createdAt: timestamp().notNull().defaultNow(),
})

const db = createDbClient({
  schema: { users },
  dialect: pgDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }),
})

const user = await db.query.users.findFirst({
  where: (_u, eb) => eb('email', '=', 'a@b.com'),
})
//    ^ { id: string; email: string; createdAt: Date } | undefined
```

`kick db generate` writes a migration from your schema changes, and `kick db migrate` applies it.

## Documentation

[kickjs.app/guide/database](https://kickjs.app/guide/database/): get started, schema, queries, relations, migrations, transactions, testing, and moving from Prisma, Drizzle, TypeORM or Sequelize.

## License

MIT
