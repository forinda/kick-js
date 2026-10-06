---
description: Taskboard part 5 — attach files to tasks with @FileUpload, keep database rows and stored bytes in step with transactions and afterCommit, then build, migrate and run the app in production.
---

# Taskboard, Part 5: Attachments and Shipping

Tasks get files: upload, list, download and delete them. Members can reach a task's files and nobody else can, and a row never points at a missing file. Then you ship: build the app, apply migrations as a deploy step, and boot it in production.

## Install the upload driver

<PmCommand exec="kick add upload" />

On Express that installs `multer` and `@types/multer`. Fastify and h3 get their own multipart driver; [`@FileUpload`](../file-uploads.md#fileupload-decorator) works the same on all three.

## The attachments table

An attachment row is the metadata. The bytes live in file storage under the row's `id`.

```ts
// src/db/schema.ts
/** A file attached to a task. The bytes live in file storage under `id`; this row is the metadata. */
export class Attachment extends TableBase('attachments', {
  id: uuid().primaryKey().defaultRandom(),
  taskId: uuid()
    .notNull()
    .references(() => Task.table.id, { onDelete: 'cascade' }),
  fileName: varchar(255).notNull(),
  contentType: varchar(100).notNull(),
  size: integer().notNull(),
  uploadedBy: uuid()
    .notNull()
    .references(() => User.table.id),
  createdAt: timestamp().notNull().defaultNow(),
}) {}

export const taskRelations = relations(Task.table, ({ one, many }) => ({
  project: one(Project.table, { fields: [Task.table.projectId], references: [Project.table.id] }),
  attachments: many(Attachment.table),
}))

export const attachmentRelations = relations(Attachment.table, ({ one }) => ({
  task: one(Task.table, { fields: [Attachment.table.taskId], references: [Task.table.id] }),
}))
```

Add `integer` to the `@forinda/kickjs-db` import, then generate the migration:

<PmCommand exec="kick db generate add_attachments" />

```sql
-- db/migrations/<timestamp>_add_attachments/up.sql (id default trimmed)
CREATE TABLE "attachments" (
  "id" TEXT NOT NULL DEFAULT (...),
  "taskId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "uploadedBy" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("uploadedBy") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
```

Read it, mark it reviewed (`kick db migrate review <id>`), and `kick dev` applies it on the next boot.

## File storage behind an interface

The service shouldn't care where bytes go. Today that's a directory; later it might be S3. Put the three operations it needs behind an interface and a DI token:

```ts
// src/storage/files.ts
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createToken } from '@forinda/kickjs'

/** Where attachment bytes live. Swap the implementation for S3 or similar without touching callers. */
export interface FileStorage {
  put(key: string, bytes: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  remove(key: string): Promise<void>
}

export const FILE_STORAGE = createToken<FileStorage>('taskboard/FileStorage')

/** Files in a directory on disk, named by key. Keys are database-generated UUIDs, never user input. */
export function diskStorage(dir: string): FileStorage {
  return {
    async put(key, bytes) {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, key), bytes)
    },
    get: (key) => readFile(join(dir, key)),
    remove: (key) => rm(join(dir, key), { force: true }),
  }
}

/** Files in memory — for tests. */
export function memoryStorage(): FileStorage & { keys(): string[] } {
  const files = new Map<string, Buffer>()
  return {
    async put(key, bytes) {
      files.set(key, bytes)
    },
    async get(key) {
      const bytes = files.get(key)
      if (!bytes) throw new Error(`No file ${key}`)
      return bytes
    },
    async remove(key) {
      files.delete(key)
    },
    keys: () => [...files.keys()],
  }
}
```

The key is always the attachment's `id`, a UUID the database generated, never the uploaded file name. So a name like `../../etc/passwd` can't steer a write outside the directory. The name is stored as data and only used in the download header.

The directory comes from config. Add it to the env schema next to `SESSION_SECRET`:

```ts
// src/config/index.ts
    // Where attachment files are written.
    UPLOAD_DIR: z.string().default('uploads'),
```

and register the storage, plus a repository, in the task module:

```ts
// src/modules/tasks/task.module.ts
register(container) {
  container.registerFactory(TASK_REPOSITORY, () => createTaskRepository(container.resolve(APP_DB)))
  container.registerFactory(ATTACHMENT_REPOSITORY, () =>
    createAttachmentRepository(container.resolve(APP_DB)),
  )
  container.registerFactory(FILE_STORAGE, () => diskStorage(env.UPLOAD_DIR))
},
```

## The repository

```ts
// src/modules/tasks/attachment.repository.ts
import { createToken } from '@forinda/kickjs'
import type { AppDb } from '../../db/client'

export interface NewAttachment {
  taskId: string
  fileName: string
  contentType: string
  size: number
  uploadedBy: string
}

export function createAttachmentRepository(db: AppDb) {
  return {
    async create(attachment: NewAttachment) {
      return db
        .insertInto('attachments')
        .values(attachment)
        .returningAll()
        .executeTakeFirstOrThrow()
    },

    async listForTask(taskId: string) {
      return db
        .selectFrom('attachments')
        .selectAll()
        .where('taskId', '=', taskId)
        .orderBy('createdAt')
        .execute()
    },

    async findForTask(taskId: string, id: string) {
      return db
        .selectFrom('attachments')
        .selectAll()
        .where('taskId', '=', taskId)
        .where('id', '=', id)
        .executeTakeFirst()
    },

    async delete(id: string) {
      await db.deleteFrom('attachments').where('id', '=', id).execute()
    },
  }
}

export type AttachmentRepository = ReturnType<typeof createAttachmentRepository>

export const ATTACHMENT_REPOSITORY = createToken<AttachmentRepository>(
  'taskboard/Attachment/repository',
)
```

`findForTask` matches on both ids. That way an attachment id from another task doesn't resolve through this task's URL.

## Rows and bytes stay in step

There are two stores, the database and the files, and no transaction spans both. Order the writes so a failure leaves nothing half-done:

- **Upload**: insert the row, then write the file, both inside `transaction()`. If the write throws, the transaction rolls back and the row is gone.
- **Delete**: delete the row, and remove the file in [`afterCommit`](../database/transactions.md#after-commit). If the delete rolls back, the file is never touched.

You never get a row pointing at a missing file. The reverse can happen: if the commit itself fails after the upload's write, or the process dies between a delete's commit and its `afterCommit`, a file is left with no row. An orphan wastes space but serves nothing — no route reaches a file without its row. If that matters at your scale, sweep now and then: list the storage keys, and remove the ones with no `attachments` row that are older than an hour.

```ts
// src/modules/tasks/attachment.service.ts
import { HttpException, Inject, Service } from '@forinda/kickjs'
import { APP_DB } from '../../db/token'
import type { AppDb } from '../../db/client'
import { FILE_STORAGE, type FileStorage } from '../../storage/files'
import { ATTACHMENT_REPOSITORY, type AttachmentRepository } from './attachment.repository'
import { TaskService } from './task.service'

export interface UploadedFile {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

@Service()
export class AttachmentService {
  constructor(
    @Inject(ATTACHMENT_REPOSITORY) private readonly repo: AttachmentRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(APP_DB) private readonly db: AppDb,
    private readonly tasks: TaskService,
  ) {}

  /**
   * Save the row and the bytes together: the file is written inside the
   * transaction, so a failed write rolls the row back.
   */
  async upload(taskId: string, userId: string, file: UploadedFile) {
    await this.tasks.findById(taskId, userId)
    return this.db.transaction(async () => {
      const attachment = await this.repo.create({
        taskId,
        fileName: file.originalname,
        contentType: file.mimetype,
        size: file.size,
        uploadedBy: userId,
      })
      await this.storage.put(attachment.id, file.buffer)
      return attachment
    })
  }

  async list(taskId: string, userId: string) {
    await this.tasks.findById(taskId, userId)
    return this.repo.listForTask(taskId)
  }

  async download(taskId: string, id: string, userId: string) {
    const attachment = await this.find(taskId, id, userId)
    return { attachment, bytes: await this.storage.get(attachment.id) }
  }

  /** Delete the row now, the bytes once that commits — never a row pointing at a missing file. */
  async delete(taskId: string, id: string, userId: string) {
    const attachment = await this.find(taskId, id, userId)
    await this.db.transaction(async () => {
      await this.repo.delete(attachment.id)
      await this.db.afterCommit(() => this.storage.remove(attachment.id))
    })
  }

  private async find(taskId: string, id: string, userId: string) {
    await this.tasks.findById(taskId, userId)
    const attachment = await this.repo.findForTask(taskId, id)
    if (!attachment) throw HttpException.notFound('Attachment not found')
    return attachment
  }
}
```

Access is the same check as Part 4: every method starts with `tasks.findById(taskId, userId)`, which answers 404 to anyone outside the task's project. The repository calls inside `transaction()` use the plain injected client. They [join the transaction](../database/transactions.md#transactions-follow-the-call-chain) because it follows the call chain.

Deleting a whole task has the same problem. `ON DELETE CASCADE` removes the attachment rows, but nothing removes their files. `TaskService.delete` collects the files first, then removes them after the commit:

```ts
// src/modules/tasks/task.service.ts
/** The task's attachments go with it: rows by cascade, files once the delete commits. */
async delete(id: string, userId: string): Promise<void> {
  await this.findById(id, userId)
  await this.db.transaction(async () => {
    const files = await this.attachments.listForTask(id)
    await this.repo.delete(id)
    await this.db.afterCommit(() => Promise.all(files.map((f) => this.storage.remove(f.id))))
  })
}
```

`TaskService` now also injects `ATTACHMENT_REPOSITORY`, `FILE_STORAGE` and `APP_DB`.

## Routes

```ts
// src/modules/tasks/task.controller.ts
@Autowired() private readonly attachments!: AttachmentService

@Post('/:id/attachments')
@FileUpload({ mode: 'single', fieldName: 'file', maxSize: 10_000_000 })
async upload(ctx: Ctx<KickRoutes.TaskController['upload']>) {
  if (!ctx.file) {
    ctx.problem.badRequest({ detail: 'Send the file in a multipart field named "file"' })
    return
  }
  return reply.created(await this.attachments.upload(ctx.params.id, ctx.require('user').id, ctx.file))
}

@Get('/:id/attachments')
async attachmentsOf(ctx: Ctx<KickRoutes.TaskController['attachmentsOf']>) {
  return this.attachments.list(ctx.params.id, ctx.require('user').id)
}

@Get('/:id/attachments/:attachmentId')
async download(ctx: Ctx<KickRoutes.TaskController['download']>) {
  const { attachment, bytes } = await this.attachments.download(
    ctx.params.id,
    ctx.params.attachmentId,
    ctx.require('user').id,
  )
  // Private to the project's members — no shared cache may keep a copy.
  ctx.setHeader('Cache-Control', 'no-store')
  return ctx.download(bytes, attachment.fileName, attachment.contentType)
}

@Delete('/:id/attachments/:attachmentId')
async removeAttachment(ctx: Ctx<KickRoutes.TaskController['removeAttachment']>) {
  await this.attachments.delete(ctx.params.id, ctx.params.attachmentId, ctx.require('user').id)
  return reply.noContent()
}
```

- `@FileUpload` buffers the file in memory and puts it on `ctx.file` in the Multer shape. A file over `maxSize` is rejected before your handler runs ([what a rejected upload returns](../file-uploads.md#what-a-rejected-upload-returns)). Add `allowedTypes` to restrict the kinds of file.
- [`ctx.download()`](../controllers.md#returning-a-generated-file) sets `Content-Disposition` and `Content-Type` and sends the bytes, the same way on every runtime. It encodes the file name, so an uploaded name with quotes or non-Latin characters can't break the header.
- `Cache-Control: no-store` keeps proxies and CDNs from storing the file and handing it to someone else — the download is only for members.
- These routes need no `@Public`. `LoadUser` from Part 3 already requires a signed-in user.

Try it with a signed-in cookie jar from Part 3:

```bash
curl -b jar -F file=@notes.txt localhost:3000/api/v1/tasks/$TASK/attachments
curl -b jar localhost:3000/api/v1/tasks/$TASK/attachments
curl -b jar -OJ localhost:3000/api/v1/tasks/$TASK/attachments/$ATTACHMENT
```

## Test it

The test app swaps disk storage for memory. That way tests write nothing to disk, and they can see what's stored:

```ts
// test/app.ts — the imports from Part 4, plus the storage token
import request from 'supertest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

import { createTestDb } from './db'
import { APP_DB } from '../src/db/token'
import { FILE_STORAGE, memoryStorage } from '../src/storage/files'
import { LoadUser } from '../src/auth/current-user'
import { middlewares } from '../src/middleware'
import { AuthModule } from '../src/modules/auth/auth.module'
import { ProjectModule } from '../src/modules/projects/project.module'
import { TaskModule } from '../src/modules/tasks/task.module'

export async function testApp() {
  Container.reset()
  const storage = memoryStorage()
  const { app } = await createTestApp({
    modules: [AuthModule(), ProjectModule(), TaskModule()],
    middlewares,
    contributors: [LoadUser.registration],
    overrides: [
      [APP_DB, createTestDb()],
      [FILE_STORAGE, storage],
    ],
  })
  // … agent() and signUp() as in Part 4
  return { agent, signUp, storage }
}
```

```ts
// src/modules/tasks/__tests__/attachments.test.ts
import { describe, it, expect } from 'vitest'
import { testApp } from '../../../../test/app'

describe('task attachments', () => {
  async function scene() {
    const app = await testApp()
    const ada = await app.signUp('ada@example.com')
    const project = await ada.post('/api/v1/projects').send({ name: 'Launch' })
    const task = await ada
      .post('/api/v1/tasks')
      .send({ projectId: project.body.id, title: 'Design' })
    return { ...app, ada, url: `/api/v1/tasks/${task.body.id}` }
  }

  it('uploads, lists and downloads a file', async () => {
    const { ada, url } = await scene()
    const uploaded = await ada
      .post(`${url}/attachments`)
      .attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' })
    expect(uploaded.status).toBe(201)
    expect(uploaded.body).toMatchObject({
      fileName: 'notes.txt',
      contentType: 'text/plain',
      size: 5,
    })

    const list = await ada.get(`${url}/attachments`)
    expect(list.body).toHaveLength(1)

    const file = await ada.get(`${url}/attachments/${uploaded.body.id}`)
    expect(file.status).toBe(200)
    expect(file.headers['content-disposition']).toContain('notes.txt')
    expect(file.headers['cache-control']).toBe('no-store')
    expect(file.text).toBe('hello')
  })

  it('removes the file once the delete commits', async () => {
    const { ada, url, storage } = await scene()
    const uploaded = await ada.post(`${url}/attachments`).attach('file', Buffer.from('x'), 'a.txt')
    expect(storage.keys()).toEqual([uploaded.body.id])

    await ada.delete(`${url}/attachments/${uploaded.body.id}`).expect(204)
    expect(storage.keys()).toEqual([])
  })

  it("deleting a task removes its attachments' files", async () => {
    const { ada, url, storage } = await scene()
    await ada.post(`${url}/attachments`).attach('file', Buffer.from('x'), 'a.txt')
    await ada.post(`${url}/attachments`).attach('file', Buffer.from('y'), 'b.txt')

    await ada.delete(url).expect(204)
    expect(storage.keys()).toEqual([])
  })

  it("keeps other people's files private", async () => {
    const { ada, signUp, url } = await scene()
    const uploaded = await ada.post(`${url}/attachments`).attach('file', Buffer.from('x'), 'a.txt')
    const eve = await signUp('eve@example.com')
    await eve.get(`${url}/attachments/${uploaded.body.id}`).expect(404)
    await eve.post(`${url}/attachments`).attach('file', Buffer.from('x'), 'b.txt').expect(404)
  })
})
```

<PmCommand exec="kick test" />

## Ship it

### Configuration

Production reads its settings from the environment. Everything the app needs:

| Variable          | Read by                                 | Notes                                                              |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `NODE_ENV`        | `src/index.ts`, the migration runner    | `production`; `kick start` sets it for you                         |
| `PORT`            | the env schema                          | defaults to `3000`                                                 |
| `SESSION_SECRET`  | the env schema → `session()`            | required, 32+ characters: `openssl rand -hex 32`                   |
| `UPLOAD_DIR`      | the env schema → `diskStorage()`        | defaults to `uploads`; put it on a persistent volume               |
| `AUTH_RATE_LIMIT` | the env schema → the auth controller    | defaults to `10` attempts per IP per 15 minutes                    |
| `DB_FILE`         | `src/db/client.ts` and `kick.config.ts` | defaults to `taskboard.db`; the app and `kick db` must agree on it |

The env schema validates at boot, so a missing or short `SESSION_SECRET` stops the app before it serves anything. Keep `.env.example` listing every key with placeholder values. See [Configuration](../configuration.md).

### Build

<PmCommand exec="kick build" />

That writes `dist/index.js`.

### Migrate, then start

`src/index.ts` set the boot policy in Part 2:

```ts
migrationsOnBoot: process.env.NODE_ENV === 'development' ? 'apply' : 'fail-if-pending',
```

In development, migrations apply on boot. Anywhere else, the app refuses to start while a migration is pending, and the process exits with code 1. A deploy with an unapplied migration fails visibly instead of serving queries against the old schema:

```text
ERROR [Process] Uncaught exception Error: kickjs-db: 4 pending migration(s); run `kick db migrate latest` before boot
```

So applying migrations is its own deploy step, run before the new version starts:

```bash
export NODE_ENV=production DB_FILE=/var/lib/taskboard/taskboard.db
```

<PmCommand exec="kick db migrate status" />

<PmCommand exec="kick db migrate latest" />

```text
Applied batch 1: …_init, …_add_users, …_add_project_members, …_add_attachments
```

Outside development the runner applies only migrations marked reviewed. A migration someone generated but never read stops the deploy. That's why every migration in this series went through `kick db migrate review`. The runner also checks each migration's hash and compares the live schema with the last snapshot before it changes anything. [Migrations](../database/migrations.md#boot-time-policy) covers the policy and its options.

Then start the server:

<PmCommand exec="kick start" />

`kick start` runs `dist/index.js` with `NODE_ENV=production`. `node dist/index.js` works the same if your platform runs Node directly.

```bash
curl localhost:3000/api/v1/projects
# {"status":401,"detail":"Sign in first",...}
```

## What you built

Across the five parts:

- **Modules**: a module per feature, each with a controller, service and repository, plus the generators that write them.
- **A schema in TypeScript**: class-form tables with a decimal budget, a custom JSON column, CHECK constraints, a composite primary key and relations. Reviewed migrations are generated from it.
- **Repositories on kick/db**: typed queries, relational reads, validation derived from the table, and typed database errors mapped to HTTP status codes.
- **Session authentication**: scrypt password hashing, a `LoadUser` context contributor on every route, and `@Public` for the exceptions.
- **Authorization**: project membership and an owner role, enforced by contributors that `dependsOn` the user. Outsiders get a 404.
- **Transactions**: a project and its owner created together, file bytes kept in step with their rows through `transaction()` and `afterCommit`.
- **Tests**: the whole app on an in-memory database, with real sessions and swapped storage.
- **A deploy**: a validated environment, a build, migrations as an explicit step, and a boot that refuses to run against an unmigrated database.

## Further reading

- [File Uploads](../file-uploads.md): `allowedTypes`, multiple files, rejected uploads
- [Transactions](../database/transactions.md): savepoints, retries, `afterCommit`
- [Migrations](../database/migrations.md): rollback, boot policy, the review gate
- [Database testing](../database/testing.md): more patterns for testing against kick/db
- [Authorization](../authorization.md): policies and role checks beyond one owner
- [Serverless](../serverless.md) and [Edge deployment](../edge-deployment.md): other places to run the app
