---
description: Taskboard Part 2 — move projects from an in-memory Map to SQLite with kick/db, add tasks with a custom column and an exact decimal budget, and test against a throwaway database.
---

# Taskboard, Part 2: A Real Database

In [Part 1](./1-first-module.md) projects lived in a `Map` and vanished on restart. This part puts them in SQLite with kick/db, and adds the second half of the app: tasks. By the end you have:

- a schema written as TypeScript classes, with a decimal budget, a CHECK on task status, and a custom column that stores a list of labels;
- migrations you generate, read, and apply;
- the project repository rewritten on the database — and the controller and service unchanged;
- a tasks module, and a project read that returns its tasks in one query;
- tests that run against a fresh in-memory database each time.

## Install the driver

<PmCommand exec="kick add sqlite" />

This installs `@forinda/kickjs-db`, the `better-sqlite3` driver and its types. `better-sqlite3` is a native addon, so `kick add` also allows its install script — pnpm refuses to run it otherwise.

## Mount the `kick db` commands

The `kick db` command tree ships with `@forinda/kickjs-db` and is opt-in. Add the plugin and a `db` block to `kick.config.ts`:

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'
import { dbCliPlugin } from '@forinda/kickjs-db/cli'

export default defineConfig({
  plugins: [dbCliPlugin],
  db: {
    schemaPath: 'src/db/schema.ts',
    migrationsDir: 'db/migrations',
    dialect: 'sqlite',
    adapter: async () => {
      const Database = (await import('better-sqlite3')).default
      const { sqliteAdapter } = await import('@forinda/kickjs-db/sqlite')
      return sqliteAdapter({ database: new Database(process.env.DB_FILE ?? 'taskboard.db') })
    },
  },
  // …the rest of the generated config
})
```

`schemaPath` is where `kick db generate` reads your tables; `adapter` is the connection `kick db migrate` uses. `DB_FILE` lets production point at a different file — you'll use it in Part 5.

## The schema

A table can be written four ways — an object, class fields, a base class, or a fluent builder ([Table Forms](../db-table-forms.md)). Taskboard uses the base class: the class _is_ the row type, and it can carry methods.

```ts
// src/db/schema.ts
import {
  TableBase,
  check,
  customType,
  decimal,
  relations,
  text,
  timestamp,
  uuid,
  varchar,
} from '@forinda/kickjs-db'

/** A list of labels, stored as JSON text. */
const labelList = customType<string[]>({
  dataType: () => 'text',
  toDriver: (labels) => JSON.stringify(labels),
  fromDriver: (stored) => JSON.parse(stored as string) as string[],
})

export class Project extends TableBase('projects', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar(200).notNull(),
  description: text(),
  budget: decimal(12, 2),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
}) {}

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export class Task extends TableBase(
  'tasks',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => Project.table.id, { onDelete: 'cascade' }),
    title: varchar(200).notNull(),
    status: varchar(20).notNull().default('todo'),
    labels: labelList().notNull().default('[]'),
    createdAt: timestamp().notNull().defaultNow(),
  },
  {
    indexes: () => ({
      validStatus: check('tasks_status_valid', "status in ('todo', 'doing', 'done')"),
    }),
  },
) {
  get isDone() {
    return this.status === 'done'
  }
}

export const projectRelations = relations(Project.table, ({ many }) => ({
  tasks: many(Task.table),
}))

export const taskRelations = relations(Task.table, ({ one }) => ({
  project: one(Project.table, { fields: [Task.table.projectId], references: [Project.table.id] }),
}))
```

A few things worth noticing:

- **`Project.table` is the table.** Anywhere kick/db wants a table — a foreign key, `relations()`, `insertSchema` below — pass `Project.table`. The class itself is the row type.
- **Methods need a real instance.** Queries return plain rows; `Task.from(row)` turns one into a `Task`, so `task.isDone` works. You'll do that in the task repository.
- **`budget` is a string.** `decimal(12, 2)` reads back as `'1500.50'`, never `1500.5`, so no cent is lost to floating point. Do arithmetic on it with a decimal library or in SQL. SQLite has no exact decimal type — it stores a float — and kick/db reads it back as the same string at the column's scale, exact up to 15 significant digits, plenty for a budget.
- **`labels` is a custom column.** `customType<string[]>()` says how to write the value (`toDriver`) and read it back (`fromDriver`). SQLite has no array type, so the list goes in as JSON text and comes out as `string[]` — including in nested reads. See [Extensions](../db-extensions.md) for more custom types.
- **The CHECK backs up validation.** The API validates `status` too, but the database is the last word: nothing — a script, a console session — can store `'blocked'`.
- **`onDelete: 'cascade'`** deletes a project's tasks with it.

[Tables & Columns](../database/schema.md) and [Keys & Constraints](../database/constraints.md) cover every builder used here.

## Generate, review, apply

<PmCommand exec="kick db generate init" />

kick/db diffs the schema against the last migration (here: nothing) and writes `db/migrations/<timestamp>_init/` — `up.sql`, `down.sql`, `snapshot.json` and `meta.json`. Read `up.sql`; it is what will run. It creates `projects`, then `tasks` — the `tasks` half:

```sql
CREATE TABLE "tasks" (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'todo',
  "labels" TEXT NOT NULL DEFAULT '[]',
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "tasks_status_valid" CHECK (status in ('todo', 'doing', 'done'))
);
```

SQLite has no UUID function, so `defaultRandom()` becomes an expression that builds a version-4 UUID, and `defaultNow()` stores milliseconds so rows created in the same second still sort.

A generated migration is a draft until someone has read it. Mark it reviewed, then apply it. `<id>` is the folder name your `generate` printed, such as `20261002_155913_init`:

<PmCommand exec="kick db migrate review <id>" />

<PmCommand exec="kick db migrate latest" />

Outside development the runner refuses unreviewed migrations, so a migration nobody looked at never reaches production. [Migrations](../database/migrations.md) covers status, rollback and the rest.

In development you rarely need `migrate latest` by hand — the app applies pending migrations as it boots. That's the `kickDbAdapter` in `src/index.ts` (`migrationAdapter` comes from `src/db/client.ts`, written in [the next section](#the-client-in-di)):

```ts
// src/index.ts
import { kickDbAdapter } from '@forinda/kickjs-db'
import { migrationAdapter } from './db/client'

import 'reflect-metadata'
import './config'
import { bootstrap, cors, expressRuntime, helmet, requestId, requestLogger } from '@forinda/kickjs'
import express from 'express'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { kickDbAdapter } from '@forinda/kickjs-db'
import { migrationAdapter } from './db/client'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  runtime: expressRuntime(),
  adapters: [
    DevToolsAdapter(),
    kickDbAdapter({
      migrationAdapter,
      migrationsDir: 'db/migrations',
      // Apply pending migrations on boot in development; refuse to start elsewhere.
      migrationsOnBoot: process.env.NODE_ENV === 'development' ? 'apply' : 'fail-if-pending',
    }),
  ],
  middlewares: [helmet(), cors({ origin: '*' }), requestId(), requestLogger(), express.json()],
})
```

Anywhere else, the app refuses to start while a migration is pending — Part 5 relies on that.

## The client, in DI

One file opens the database and builds the typed client:

```ts
// src/db/client.ts
import Database from 'better-sqlite3'
import { createDbClient } from '@forinda/kickjs-db'
import { sqliteAdapter, sqliteDialect } from '@forinda/kickjs-db/sqlite'
import * as schema from './schema'

const database = new Database(process.env.DB_FILE ?? 'taskboard.db')
// SQLite leaves foreign keys off by default; ON DELETE CASCADE needs them on.
database.pragma('foreign_keys = ON')

export const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
export type AppDb = typeof db

// The same connection runs migrations — one handle, not two.
export const migrationAdapter = sqliteAdapter({ database })
```

Code reaches it through a token rather than an import, so a test can hand in a different database:

```ts
// src/db/token.ts
import { createToken } from '@forinda/kickjs'
import type { AppDb } from './client'

export const APP_DB = createToken<AppDb>('taskboard/Db')
```

Token names follow `<scope>/<PascalKey>` — your project's scope, then the thing. `kick typegen` warns about names that don't.

A small module registers the client. It serves no HTTP routes, so `routes` returns `null`:

```ts
// src/db/db.module.ts
import { defineModule } from '@forinda/kickjs'
import { db } from './client'
import { APP_DB } from './token'

export const DbModule = defineModule({
  name: 'DbModule',
  build: () => ({
    register(container) {
      container.registerFactory(APP_DB, () => db)
    },
    routes: () => null, // registers the client; serves no routes
  }),
})
```

Mount it first in `src/modules/index.ts`, so the token is registered before the modules that use it:

```ts
// src/modules/index.ts
export const modules = defineModules().mount(DbModule()).mount(ProjectModule()).mount(TaskModule())
```

## Projects on the database

In Part 1 the repository factory returned methods over a `Map`. Rewrite the bodies against the client and keep the shape:

```ts
// src/modules/projects/project.repository.ts
import { createToken, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { AppDb } from '../../db/client'
import type { CreateProjectDTO } from './dtos/create-project.dto'
import type { UpdateProjectDTO } from './dtos/update-project.dto'

export function createProjectRepository(db: AppDb) {
  return {
    async findById(id: string) {
      return (
        (await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst()) ??
        null
      )
    },

    async findPaginated(parsed: ParsedQuery) {
      const { offset, limit } = parsed.pagination
      const [data, { total }] = await Promise.all([
        db
          .selectFrom('projects')
          .selectAll()
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .offset(offset)
          .execute(),
        db
          .selectFrom('projects')
          .select((eb) => eb.fn.countAll<number>().as('total'))
          .executeTakeFirstOrThrow(),
      ])
      return { data, total: Number(total) }
    },

    /** A project with its tasks, in one query. */
    async findWithTasks(id: string) {
      return db.query.projects.findFirst({
        where: (p, eb) => eb('id', '=', id),
        with: { tasks: true },
      })
    },

    async create(dto: CreateProjectDTO) {
      return db.insertInto('projects').values(dto).returningAll().executeTakeFirstOrThrow()
    },

    async update(id: string, dto: UpdateProjectDTO) {
      const row = await db
        .updateTable('projects')
        .set({ ...dto, updatedAt: new Date() })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst()
      if (!row) throw HttpException.notFound('Project not found')
      return row
    },

    async delete(id: string) {
      const { numDeletedRows } = await db
        .deleteFrom('projects')
        .where('id', '=', id)
        .executeTakeFirst()
      if (numDeletedRows === 0n) throw HttpException.notFound('Project not found')
    },
  }
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>

export const PROJECT_REPOSITORY = createToken<ProjectRepository>('taskboard/Project/repository')
```

The module hands it the client from DI:

```ts
// src/modules/projects/project.module.ts — register()
container.registerFactory(PROJECT_REPOSITORY, () =>
  createProjectRepository(container.resolve(APP_DB)),
)
```

`ProjectRepository` is whatever the factory returns, so the service and controller compile against the new bodies unchanged — that's the point of putting storage behind a repository. Every query is checked against the schema: a misspelled column or a `budget` passed as a number is a compile error. [Queries](../database/queries.md) and [Repositories](../database/repositories.md) go further.

Two changes on top: `findWithTasks` replaces `findById` in the controller's `GET /:id`, and the generated `findAll` goes — the list route already paginates.

### Request bodies from the table

The Part 1 DTOs repeated the columns by hand in Zod. Derive them from the table instead, so a column's limits are written once:

```ts
// src/modules/projects/dtos/create-project.dto.ts
import { insertSchema } from '@forinda/kickjs-db/schema'
import type { InferSchemaOutput } from '@forinda/kickjs-schema'
import { Project } from '../../../db/schema'

/**
 * The request body for creating a project, derived from the table: `name` is
 * required and at most 200 characters, `budget` is a decimal with at most two
 * places. The database fills the id and timestamps, so they're left out.
 */
export const createProjectSchema = insertSchema(Project.table, {
  omit: ['id', 'createdAt', 'updatedAt'],
  columns: { name: { minLength: 1 } },
})

export type CreateProjectDTO = InferSchemaOutput<typeof createProjectSchema>
```

```ts
// src/modules/projects/dtos/update-project.dto.ts
import { updateSchema } from '@forinda/kickjs-db/schema'
import type { InferSchemaOutput } from '@forinda/kickjs-schema'
import { Project } from '../../../db/schema'

export const updateProjectSchema = updateSchema(Project.table, {
  omit: ['id', 'createdAt', 'updatedAt'],
  columns: { name: { minLength: 1 } },
})

export type UpdateProjectDTO = InferSchemaOutput<typeof updateProjectSchema>
```

The controller passes them to `@Post` and `@Put` exactly as before. The decimal column brings its precision with it — `decimal(12, 2)` takes at most ten digits before the point and two after:

```bash
curl -s -X POST localhost:3000/api/v1/projects \
  -H 'content-type: application/json' -d '{"name":"X","budget":"1.005"}'
# {"status":422,"detail":"At most 2 digit(s) after the decimal point",
#  "errors":[{"field":"budget","message":"At most 2 digit(s) after the decimal point"}], …}
```

Without that check the database would round `1.005` away silently. [Validation from Tables](../db-table-schemas.md) lists what each column type accepts.

## Tasks

Generate the module, then point it at the database the same way:

<PmCommand exec="kick g module task" />

The task DTOs stay in Zod — the status list comes from the schema, so the API and the CHECK agree:

```ts
// src/modules/tasks/dtos/create-task.dto.ts
import { z } from 'zod'
import { TASK_STATUSES } from '../../../db/schema'

export const createTaskSchema = z.object({
  projectId: z.uuid(),
  title: z.string().min(1, 'Title is required').max(200),
  status: z.enum(TASK_STATUSES).optional(),
  labels: z.array(z.string().min(1).max(30)).max(10).optional(),
})

export type CreateTaskDTO = z.infer<typeof createTaskSchema>
```

```ts
// src/modules/tasks/dtos/update-task.dto.ts
import { z } from 'zod'
import { TASK_STATUSES } from '../../../db/schema'

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  labels: z.array(z.string().min(1).max(30)).max(10).optional(),
})

export type UpdateTaskDTO = z.infer<typeof updateTaskSchema>
```

The repository returns `Task` instances, and turns a missing project into a 404:

```ts
// src/modules/tasks/task.repository.ts
import { createToken, HttpException } from '@forinda/kickjs'
import { ForeignKeyViolationError } from '@forinda/kickjs-db'
import type { AppDb } from '../../db/client'
import { Task } from '../../db/schema'
import type { CreateTaskDTO } from './dtos/create-task.dto'
import type { UpdateTaskDTO } from './dtos/update-task.dto'

export function createTaskRepository(db: AppDb) {
  return {
    async findById(id: string) {
      const row = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst()
      return row ? Task.from(row) : null
    },

    async create(dto: CreateTaskDTO) {
      try {
        return Task.from(
          await db.insertInto('tasks').values(dto).returningAll().executeTakeFirstOrThrow(),
        )
      } catch (err) {
        // The foreign key on projectId already guards this — turn it into a 404.
        if (err instanceof ForeignKeyViolationError)
          throw HttpException.notFound('Project not found')
        throw err
      }
    },

    async update(id: string, dto: UpdateTaskDTO) {
      const row = await db
        .updateTable('tasks')
        .set(dto)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst()
      if (!row) throw HttpException.notFound('Task not found')
      return Task.from(row)
    },

    async delete(id: string) {
      const { numDeletedRows } = await db
        .deleteFrom('tasks')
        .where('id', '=', id)
        .executeTakeFirst()
      if (numDeletedRows === 0n) throw HttpException.notFound('Task not found')
    },
  }
}

export type TaskRepository = ReturnType<typeof createTaskRepository>

export const TASK_REPOSITORY = createToken<TaskRepository>('taskboard/Task/repository')
```

There's no "does the project exist?" query before the insert. The foreign key already answers that, atomically, and kick/db raises it as a typed `ForeignKeyViolationError` you can catch by class — the same on Postgres, MySQL and SQLite. [Errors](../database/errors.md) lists them all.

Register it in `task.module.ts` like the project repository:

```ts
// src/modules/tasks/task.module.ts — register()
container.registerFactory(TASK_REPOSITORY, () => createTaskRepository(container.resolve(APP_DB)))
```

In the controller, trim the generated routes to what a task needs — `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`; tasks are listed through their project — and drop `findAll` / `findPaginated` from the service. `values(dto)` and `set(dto)` take `labels` as `string[]`: the custom column's type flows into the query builder.

### A project with its tasks

`GET /projects/:id` now calls `findWithTasks`, which uses the relational API. `with: { tasks: true }` follows the `projectRelations` you declared and returns the project with its tasks nested, in one query. `kick typegen` — which `kick dev` runs on every save — registers the schema so the nested `tasks` are typed too.

```bash
curl -s localhost:3000/api/v1/projects/83d78821-6934-4fd3-9556-15cc5409db0a
```

```json
{
  "id": "83d78821-6934-4fd3-9556-15cc5409db0a",
  "name": "Launch",
  "description": null,
  "budget": "1500.50",
  "createdAt": "2026-10-02T15:44:43.512Z",
  "updatedAt": "2026-10-02T15:44:43.512Z",
  "tasks": [
    {
      "id": "4afb5585-6c19-486c-b1a8-9e8f981d634f",
      "projectId": "83d78821-6934-4fd3-9556-15cc5409db0a",
      "title": "Design",
      "status": "todo",
      "labels": ["ui"],
      "createdAt": "2026-10-02T15:44:43.512Z"
    }
  ]
}
```

Nested rows decode like top-level ones: `labels` is an array, dates are dates. [Relational Queries](../db-relational-query.md) covers filters, limits and deeper nesting.

## Test against a throwaway database

Tests shouldn't touch `taskboard.db`. This helper builds the whole schema in an in-memory SQLite database — milliseconds — straight from `schema.ts`, so it never lags behind a migration you forgot to apply:

```ts
// test/db.ts
import Database from 'better-sqlite3'
import { createDbClient, diff, emitSqlite, extractSnapshot } from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'
import * as schema from '../src/db/schema'

/** A fresh in-memory database with the whole schema — milliseconds to create. */
export function createTestDb() {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return createDbClient({ schema, dialect: sqliteDialect({ database }) })
}
```

Add `"test"` to `include` in `tsconfig.json` so it's type-checked with the rest.

A repository test calls the factory directly:

```ts
// src/modules/tasks/__tests__/task.repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from '../../../../test/db'
import { createProjectRepository } from '../../projects/project.repository'
import { createTaskRepository, type TaskRepository } from '../task.repository'

describe('Task repository', () => {
  let tasks: TaskRepository
  let projectId: string

  beforeEach(async () => {
    const db = createTestDb()
    tasks = createTaskRepository(db)
    projectId = (await createProjectRepository(db).create({ name: 'Launch' })).id
  })

  it('creates a task in todo', async () => {
    const task = await tasks.create({ projectId, title: 'Write the docs' })
    expect(task.status).toBe('todo')
    expect(task.isDone).toBe(false)
  })

  it('answers 404 for a project that does not exist', async () => {
    await expect(
      tasks.create({ projectId: crypto.randomUUID(), title: 'Orphan' }),
    ).rejects.toMatchObject({
      status: 404,
    })
  })

  it('moves a task to done', async () => {
    const task = await tasks.create({ projectId, title: 'Ship it' })
    const done = await tasks.update(task.id, { status: 'done' })
    expect(done.isDone).toBe(true)
  })
})
```

A controller test boots the real modules and swaps the database through the token:

```ts
// src/modules/tasks/__tests__/task.controller.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

import { createTestDb } from '../../../../test/db'
import { APP_DB } from '../../../db/token'
import { ProjectModule } from '../../projects/project.module'
import { TaskModule } from '../task.module'

describe('TaskController', () => {
  beforeEach(() => {
    Container.reset()
  })

  async function boot() {
    const { app } = await createTestApp({
      modules: [ProjectModule(), TaskModule()],
      overrides: [[APP_DB, createTestDb()]],
    })
    return request(app.handle.bind(app))
  }

  it('adds a task to a project and reads it back with the project', async () => {
    const agent = await boot()
    const project = await agent.post('/api/v1/projects').send({ name: 'Launch' })

    const task = await agent
      .post('/api/v1/tasks')
      .send({ projectId: project.body.id, title: 'Design', labels: ['ui', 'urgent'] })
    expect(task.status).toBe(201)

    await agent.patch(`/api/v1/tasks/${task.body.id}`).send({ status: 'doing' }).expect(200)

    const res = await agent.get(`/api/v1/projects/${project.body.id}`)
    expect(res.body.tasks).toMatchObject([
      { title: 'Design', status: 'doing', labels: ['ui', 'urgent'] },
    ])
  })

  it('rejects an unknown status', async () => {
    const agent = await boot()
    const project = await agent.post('/api/v1/projects').send({ name: 'Launch' })
    const res = await agent
      .post('/api/v1/tasks')
      .send({ projectId: project.body.id, title: 'x', status: 'blocked' })
    expect(res.status).toBe(422)
  })

  it('answers 404 for a project that does not exist', async () => {
    const agent = await boot()
    const res = await agent
      .post('/api/v1/tasks')
      .send({ projectId: crypto.randomUUID(), title: 'x' })
    expect(res.status).toBe(404)
  })
})
```

`overrides: [[APP_DB, createTestDb()]]` replaces the registration `DbModule` would make, so each test starts from an empty database without mounting `DbModule` at all. Write the project controller test the same way, with a case for the `422` on `budget: '10.005'`. [Database Testing](../database/testing.md) covers transactions-per-test and other dialects.

<PmCommand run="test" />

## What you built

- A schema in class form: `Project` with an exact `decimal(12, 2)` budget, `Task` with a CHECK on status, a custom `labels` column, a cascading foreign key and an `isDone` method.
- A reviewed `init` migration, applied on boot in development and required before boot elsewhere.
- The database client in DI behind the `taskboard/Db` token, registered by a route-less `DbModule`.
- Project and task repositories on kick/db — validation derived from the table, a foreign key turned into a 404, a project read that returns its tasks in one query.
- Tests on a fresh in-memory database, swapped in through the same token.

Next: [Part 3: Authentication](./3-authentication.md) — users, password hashing, sessions, and protecting every route by default.
