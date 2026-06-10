---
title: Database
subtitle: Code-first schema, migrations, 3 dialects
number: '05'
tag: Data
accent: '#f59e0b'
---

# Database with kickjs-db

`@forinda/kickjs-db` is a code-first ORM: your `schema.ts` is the source of truth for types, migrations, and introspection. PostgreSQL, SQLite, and MySQL — same API.

## Define a schema

```ts
// src/db/schema.ts
import { table, uuid, varchar, boolean, timestamp } from '@forinda/kickjs-db'

export const tasks = table('tasks', {
  id: uuid().primaryKey().defaultRandom(),
  title: varchar(200).notNull(),
  done: boolean().notNull().default(false),
  createdAt: timestamp().notNull().defaultNow(),
})
```

## Generate + run migrations

```bash
kick db generate add_tasks     # diffs schema → up.sql / down.sql
kick db migrate review <id>    # mark reviewed (gate before apply)
kick db migrate latest         # apply
```

`generate` emits dialect-correct DDL. On SQLite it even emits the safe **table-rebuild** for column changes `ALTER TABLE` can't express. On MySQL it uses `MODIFY COLUMN` / backtick identifiers.

## Query

```ts
import { createDbClient } from '@forinda/kickjs-db'
import * as schema from './schema'

const db = createDbClient({ schema, dialect /* pg | sqlite | mysql */ })

const open = await db.selectFrom('tasks').where('done', '=', false).selectAll().execute()

// Relational queries, no N+1:
const withAuthor = await db.query.tasks.findMany({ with: { author: true } })
```

## Reverse-engineer an existing DB

```bash
kick db introspect --out src/db/schema.ts
```

Works on all three dialects. And `kick db migrate` runs **drift detection** — if someone ran DDL out of band, it stops you (dialect-normalised, so SQLite/MySQL's lossy types don't false-positive).

## Why it matters

- **One schema, everything derived** — types, migrations, introspection. No drift between an ORM model and a separate migration file.
- **Real migrations** — reversible, reviewed, hashed; not "push and pray".
- **Portable** — prototype on SQLite, ship on Postgres, with the same code.

## Next

[CLI Plugins & Generators →](./06-cli-plugins.md)
