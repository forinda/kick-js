---
description: Taskboard Part 4 — project memberships with a composite primary key, access checks as context contributors, a transaction across a service, and typed database errors as HTTP statuses.
---

# Taskboard, Part 4: Teams and Permissions

At the end of [Part 3](./3-authentication.md) every signed-in user could see and change every project. This part makes projects belong to people:

- a `project_members` table — who is in which project, as `owner` or `member`;
- access checks as context contributors: outsiders get a `404`, members can work, only the owner can delete or invite;
- creating a project and its owner membership in one transaction;
- a duplicate invite answered `409` by the database's primary key, with no code to detect it.

## The membership table

A membership is identified by the pair (project, user) — one row each, never two. That's a **composite primary key**, declared in the table's options with `primaryKey().on(...)`. A CHECK keeps `role` to the two values the app knows:

```ts
// src/db/schema.ts
export const MEMBER_ROLES = ['owner', 'member'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

/** Who belongs to a project, and as what. One row per (project, user). */
export class ProjectMember extends TableBase(
  'project_members',
  {
    projectId: uuid()
      .notNull()
      .references(() => Project.table.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => User.table.id, { onDelete: 'cascade' }),
    role: varchar(20).notNull().default('member'),
    joinedAt: timestamp().notNull().defaultNow(),
  },
  {
    indexes: (t) => ({
      pk: primaryKey().on(t.projectId, t.userId),
      validRole: check('project_members_role_valid', "role in ('owner', 'member')"),
    }),
  },
) {}
```

Add `primaryKey` to the `@forinda/kickjs-db` import. Both foreign keys cascade: deleting a project or a user removes their memberships with them.

Relations let `db.query` walk from a project to its members and back:

```ts
export const projectRelations = relations(Project.table, ({ many }) => ({
  tasks: many(Task.table),
  members: many(ProjectMember.table),
}))

export const memberRelations = relations(ProjectMember.table, ({ one }) => ({
  project: one(Project.table, {
    fields: [ProjectMember.table.projectId],
    references: [Project.table.id],
  }),
  user: one(User.table, { fields: [ProjectMember.table.userId], references: [User.table.id] }),
}))
```

Generate the migration:

<PmCommand exec="kick db generate add_project_members" />

```sql
-- db/migrations/<timestamp>_add_project_members/up.sql
CREATE TABLE "project_members" (
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "joinedAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  PRIMARY KEY ("projectId", "userId"),
  FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "project_members_role_valid" CHECK (role in ('owner', 'member'))
);
```

Read it, mark it reviewed, and `kick dev` applies it on the next start:

<PmCommand exec="kick db migrate review <id>" />

[Keys and Constraints](../database/constraints.md) covers composite keys, CHECKs and foreign-key actions in full.

::: tip Existing projects
Projects created before this migration have no members, so after it nobody can see them. In a real app you would add an owner row for each one in the same migration. In this tutorial, start from a fresh database.
:::

## Repository queries

The project repository gains four methods. Listing joins through `project_members`, so a user only ever sees their own projects:

```ts
// src/modules/projects/project.repository.ts
/** The projects `userId` belongs to, newest first. */
async findPaginatedForUser(parsed: ParsedQuery, userId: string) {
  const { offset, limit } = parsed.pagination
  const mine = db
    .selectFrom('projects')
    .innerJoin('project_members', 'project_members.projectId', 'projects.id')
    .where('project_members.userId', '=', userId)
  const [data, { total }] = await Promise.all([
    mine.selectAll('projects').orderBy('projects.createdAt', 'desc').limit(limit).offset(offset).execute(),
    mine.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow(),
  ])
  return { data, total: Number(total) }
},

async isMember(projectId: string, userId: string) {
  const row = await db
    .selectFrom('project_members')
    .select('role')
    .where('projectId', '=', projectId)
    .where('userId', '=', userId)
    .executeTakeFirst()
  return row !== undefined
},

async addMember(projectId: string, userId: string, role: MemberRole) {
  return db
    .insertInto('project_members')
    .values({ projectId, userId, role })
    .returningAll()
    .executeTakeFirstOrThrow()
},

async listMembers(projectId: string) {
  return db
    .selectFrom('project_members')
    .innerJoin('users', 'users.id', 'project_members.userId')
    .select(['users.id', 'users.email', 'users.name', 'project_members.role', 'project_members.joinedAt'])
    .where('project_members.projectId', '=', projectId)
    .orderBy('project_members.joinedAt')
    .execute()
},
```

The old `findPaginated` goes — nothing should list every project any more. `listMembers` selects named columns from `users`, so a password hash can't leak into the response by accident.

## Access checks as contributors

"Is this user in this project?" is a value several handlers need before they run — exactly what a [context contributor](../context-decorators.md) is for. Put both checks in one file:

```ts
// src/modules/projects/project-access.ts
import { defineHttpContextDecorator, HttpException } from '@forinda/kickjs'
import { APP_DB } from '../../db/token'
import type { MemberRole } from '../../db/schema'

declare module '@forinda/kickjs' {
  interface ContextMeta {
    membership: { projectId: string; role: MemberRole }
    ownerCheck: true
  }
}

/**
 * The signed-in user's membership of the project in `:id`. Someone outside
 * the project gets the same 404 as for a project that doesn't exist, so the
 * API never confirms which ids are real.
 */
export const LoadMembership = defineHttpContextDecorator({
  key: 'membership',
  dependsOn: ['user'],
  deps: { db: APP_DB },
  resolve: async (ctx, { db }) => {
    const row = await db
      .selectFrom('project_members')
      .select(['projectId', 'role'])
      .where('projectId', '=', ctx.params.id)
      .where('userId', '=', ctx.require('user').id)
      .executeTakeFirst()
    if (!row) throw HttpException.notFound('Project not found')
    return row as { projectId: string; role: MemberRole }
  },
})

/** Only the project's owner gets past this. Runs after `LoadMembership`. */
export const RequireOwner = defineHttpContextDecorator({
  key: 'ownerCheck',
  dependsOn: ['membership'],
  resolve: (ctx) => {
    if (ctx.require('membership').role !== 'owner') {
      throw HttpException.forbidden('Only the project owner can do that')
    }
    return true as const
  },
})
```

Three things are doing the work:

- **`dependsOn` sets the order.** `LoadUser` from Part 3 produces `user`; `LoadMembership` needs it; `RequireOwner` needs `membership`. KickJS sorts the contributors on each route by these edges at startup — the order you stack the decorators in doesn't matter, and a cycle fails boot.
- **`404`, not `403`, for outsiders.** A `403` would tell anyone who guesses an id that the project exists. A member who isn't the owner already knows it exists, so `RequireOwner` can say `403`.
- **A throw is the answer.** An `HttpException` thrown from `resolve` becomes the response, and the handler never runs.

[Authorization](../authorization.md) compares this with guards and policies.

## Creating a project, in one transaction

A project with no owner would be invisible to everyone, so the project row and its owner membership must be written together or not at all:

```ts
// src/modules/projects/project.service.ts
import { HttpException, Inject, Service } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import { APP_DB } from '../../db/token'
import type { AppDb } from '../../db/client'
import type { MemberRole } from '../../db/schema'
import { PROJECT_REPOSITORY, type ProjectRepository } from './project.repository'
import type { ProjectResponseDTO } from './dtos/project-response.dto'
import type { CreateProjectDTO } from './dtos/create-project.dto'
import type { UpdateProjectDTO } from './dtos/update-project.dto'

@Service()
export class ProjectService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly repo: ProjectRepository,
    @Inject(APP_DB) private readonly db: AppDb,
  ) {}

  async findWithTasks(id: string) {
    return this.repo.findWithTasks(id)
  }

  async findPaginatedForUser(parsed: ParsedQuery, userId: string) {
    return this.repo.findPaginatedForUser(parsed, userId)
  }

  /** A new project, with its creator as owner — both rows or neither. */
  async create(dto: CreateProjectDTO, ownerId: string): Promise<ProjectResponseDTO> {
    return this.db.transaction(async () => {
      // The repository holds the plain client; inside transaction() it joins this one.
      const project = await this.repo.create(dto)
      await this.repo.addMember(project.id, ownerId, 'owner')
      return project
    })
  }

  async update(id: string, dto: UpdateProjectDTO): Promise<ProjectResponseDTO> {
    return this.repo.update(id, dto)
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id)
  }

  async listMembers(projectId: string) {
    return this.repo.listMembers(projectId)
  }

  /** Add a registered user by email. Adding someone twice is a 409 — from the primary key. */
  async addMember(projectId: string, email: string, role: MemberRole) {
    const user = await this.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', email.toLowerCase())
      .executeTakeFirst()
    if (!user) throw HttpException.notFound('No user with that email')
    return this.repo.addMember(projectId, user.id, role)
  }
}
```

The repository wasn't changed and isn't handed a transaction object. Transactions in kick/db [follow the call chain](../database/transactions.md#transactions-follow-the-call-chain): any query made through the plain client while `transaction()` is running joins it. If `addMember` throws, the project insert rolls back.

`addMember` has no "already a member?" check. The composite primary key rejects the second row, kick/db raises a `UniqueViolationError`, and that error carries `status: 409` — left unhandled, it answers `409 Conflict` on its own. See [Errors](../database/errors.md).

## The controller

A DTO for invites — the role defaults to `member`:

```ts
// src/modules/projects/dtos/add-member.dto.ts
import { z } from 'zod'
import { MEMBER_ROLES } from '../../../db/schema'

export const addMemberSchema = z.object({
  email: z.email(),
  role: z.enum(MEMBER_ROLES).default('member'),
})

export type AddMemberDTO = z.infer<typeof addMemberSchema>
```

Then put the decorators on each route that has a `:id`:

```ts
// src/modules/projects/project.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Autowired,
  ApiQueryParams,
  reply,
  type Ctx,
} from '@forinda/kickjs'
import { ProjectService } from './project.service'
import { createProjectSchema } from './dtos/create-project.dto'
import { updateProjectSchema } from './dtos/update-project.dto'
import { PROJECT_QUERY_CONFIG } from './project.constants'
import { addMemberSchema } from './dtos/add-member.dto'
import { LoadMembership, RequireOwner } from './project-access'

@Controller()
export class ProjectController {
  @Autowired() private readonly projectService!: ProjectService

  @Get('/')
  @ApiQueryParams(PROJECT_QUERY_CONFIG)
  async list(ctx: Ctx<KickRoutes.ProjectController['list']>) {
    const userId = ctx.require('user').id
    return ctx.paginate(
      (parsed) => this.projectService.findPaginatedForUser(parsed, userId),
      PROJECT_QUERY_CONFIG,
    )
  }

  @LoadMembership
  @Get('/:id')
  async getById(ctx: Ctx<KickRoutes.ProjectController['getById']>) {
    // LoadMembership already answered 404 for anyone outside the project.
    return this.projectService.findWithTasks(ctx.params.id)
  }

  @Post('/', { body: createProjectSchema, name: 'CreateProject' })
  async create(ctx: Ctx<KickRoutes.ProjectController['create']>) {
    return reply.created(await this.projectService.create(ctx.body, ctx.require('user').id))
  }

  @LoadMembership
  @Put('/:id', { body: updateProjectSchema, name: 'UpdateProject' })
  async update(ctx: Ctx<KickRoutes.ProjectController['update']>) {
    return this.projectService.update(ctx.params.id, ctx.body)
  }

  @LoadMembership
  @RequireOwner
  @Delete('/:id')
  async remove(ctx: Ctx<KickRoutes.ProjectController['remove']>) {
    await this.projectService.delete(ctx.params.id)
    return reply.noContent()
  }

  @LoadMembership
  @Get('/:id/members')
  async members(ctx: Ctx<KickRoutes.ProjectController['members']>) {
    return this.projectService.listMembers(ctx.params.id)
  }

  @LoadMembership
  @RequireOwner
  @Post('/:id/members', { body: addMemberSchema })
  async addMember(ctx: Ctx<KickRoutes.ProjectController['addMember']>) {
    return reply.created(
      await this.projectService.addMember(ctx.params.id, ctx.body.email, ctx.body.role),
    )
  }
}
```

`ctx.require('user')` reads a contributor's value and throws if it's missing, so its type has no `undefined` — `ctx.get` returns `T | undefined`. The contributors above use it the same way. The handlers themselves contain no permission logic — reading the decorators above a route tells you who can call it.

## Tasks follow their project

Task routes take a task id, not a project id, so there's no `:id` for `LoadMembership` to read. The check goes in the service instead: every method takes the acting user and looks up the task's project:

```ts
// src/modules/tasks/task.service.ts
import { HttpException, Inject, Service } from '@forinda/kickjs'
import { TASK_REPOSITORY, type TaskRepository } from './task.repository'
import { PROJECT_REPOSITORY, type ProjectRepository } from '../projects/project.repository'
import type { TaskResponseDTO } from './dtos/task-response.dto'
import type { CreateTaskDTO } from './dtos/create-task.dto'
import type { UpdateTaskDTO } from './dtos/update-task.dto'

/** Every method takes the acting user: tasks are visible to their project's members only. */
@Service()
export class TaskService {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly repo: TaskRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
  ) {}

  async findById(id: string, userId: string): Promise<TaskResponseDTO> {
    const task = await this.repo.findById(id)
    // Outside the project reads the same as missing.
    if (!task || !(await this.projects.isMember(task.projectId, userId))) {
      throw HttpException.notFound('Task not found')
    }
    return task
  }

  async create(dto: CreateTaskDTO, userId: string): Promise<TaskResponseDTO> {
    if (!(await this.projects.isMember(dto.projectId, userId))) {
      throw HttpException.notFound('Project not found')
    }
    return this.repo.create(dto)
  }

  async update(id: string, dto: UpdateTaskDTO, userId: string): Promise<TaskResponseDTO> {
    await this.findById(id, userId)
    return this.repo.update(id, dto)
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.findById(id, userId)
    await this.repo.delete(id)
  }
}
```

The controller passes `ctx.require('user').id` to each call:

```ts
// src/modules/tasks/task.controller.ts
@Get('/:id')
async getById(ctx: Ctx<KickRoutes.TaskController['getById']>) {
  return this.taskService.findById(ctx.params.id, ctx.require('user').id)
}

@Post('/', { body: createTaskSchema, name: 'CreateTask' })
async create(ctx: Ctx<KickRoutes.TaskController['create']>) {
  return reply.created(await this.taskService.create(ctx.body, ctx.require('user').id))
}

@Patch('/:id', { body: updateTaskSchema, name: 'UpdateTask' })
async update(ctx: Ctx<KickRoutes.TaskController['update']>) {
  return this.taskService.update(ctx.params.id, ctx.body, ctx.require('user').id)
}

@Delete('/:id')
async remove(ctx: Ctx<KickRoutes.TaskController['remove']>) {
  await this.taskService.delete(ctx.params.id, ctx.require('user').id)
  return reply.noContent()
}
```

`findById` now throws instead of returning `null`, so the old `ctx.problem.notFound` branch in `getById` goes away.

The rule is the same everywhere: one question (`isMember`), and the same `404` whether the thing is missing or just not yours.

## Try it

Two users, two cookie jars:

```bash
H='content-type: application/json'
curl -s -c ada.txt -X POST localhost:3000/api/v1/auth/register -H "$H" \
  -d '{"email":"ada@example.com","name":"Ada","password":"correct horse battery"}'
curl -s -c bob.txt -X POST localhost:3000/api/v1/auth/register -H "$H" \
  -d '{"email":"bob@example.com","name":"Bob","password":"correct horse battery"}'

ID=$(curl -s -b ada.txt -X POST localhost:3000/api/v1/projects -H "$H" -d '{"name":"Launch"}' | jq -r .id)

curl -s -b bob.txt localhost:3000/api/v1/projects/$ID          # 404 — Bob isn't in it
curl -s -b ada.txt -X POST localhost:3000/api/v1/projects/$ID/members -H "$H" \
  -d '{"email":"bob@example.com"}'                             # 201
curl -s -b bob.txt localhost:3000/api/v1/projects/$ID          # 200 now
curl -s -b bob.txt -X DELETE localhost:3000/api/v1/projects/$ID  # 403 — owner only
curl -s -b ada.txt -X POST localhost:3000/api/v1/projects/$ID/members -H "$H" \
  -d '{"email":"bob@example.com"}'                             # 409 — already a member
```

## Testing with several users

Permission tests need several users on the same app. Extend `test/app.ts` from Part 3 so one booted app can hand out as many agents as you need — each keeps its own cookies, like a separate browser:

```ts
// test/app.ts
import request from 'supertest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

import { createTestDb } from './db'
import { APP_DB } from '../src/db/token'
import { LoadUser } from '../src/auth/current-user'
import { middlewares } from '../src/middleware'
import { AuthModule } from '../src/modules/auth/auth.module'
import { ProjectModule } from '../src/modules/projects/project.module'
import { TaskModule } from '../src/modules/tasks/task.module'

/**
 * The whole app on a fresh in-memory database, with the same middleware and
 * contributors as `src/index.ts`. Each agent keeps its own cookies, like a
 * separate browser — `signUp` gives you a signed-in one.
 */
export async function testApp() {
  Container.reset()
  const { app } = await createTestApp({
    modules: [AuthModule(), ProjectModule(), TaskModule()],
    middlewares,
    contributors: [LoadUser.registration],
    overrides: [[APP_DB, createTestDb()]],
  })
  const handler = app.handle.bind(app)
  const agent = () => request.agent(handler)
  const signUp = async (email: string) => {
    const user = agent()
    await user
      .post('/api/v1/auth/register')
      .send({ email, name: email.split('@')[0], password: 'correct horse battery' })
      .expect(201)
    return user
  }
  return { agent, signUp }
}

/** A signed-out agent on a fresh app. */
export async function bootApp() {
  return (await testApp()).agent()
}

/** A signed-in agent on a fresh app. */
export async function signedIn(email = 'ada@example.com') {
  return (await testApp()).signUp(email)
}
```

Then describe the rules as tests. A `scene()` builds an owner, a member and an outsider around one project:

```ts
// src/modules/projects/__tests__/project-access.test.ts
import { describe, it, expect } from 'vitest'
import { testApp } from '../../../../test/app'

describe('who can see and change a project', () => {
  async function scene() {
    const app = await testApp()
    const owner = await app.signUp('owner@example.com')
    const member = await app.signUp('member@example.com')
    const outsider = await app.signUp('outsider@example.com')

    const project = await owner.post('/api/v1/projects').send({ name: 'Launch' })
    await owner
      .post(`/api/v1/projects/${project.body.id}/members`)
      .send({ email: 'member@example.com' })
      .expect(201)
    return { owner, member, outsider, url: `/api/v1/projects/${project.body.id}` }
  }

  it('lists only the projects you belong to', async () => {
    const { member, outsider } = await scene()
    expect((await member.get('/api/v1/projects')).body.meta.total).toBe(1)
    expect((await outsider.get('/api/v1/projects')).body.meta.total).toBe(0)
  })

  it('hides a project from outsiders with a 404', async () => {
    const { outsider, url } = await scene()
    await outsider.get(url).expect(404)
    await outsider.put(url).send({ name: 'Mine now' }).expect(404)
  })

  it('lets members work but only the owner delete or invite', async () => {
    const { member, owner, url } = await scene()
    await member.put(url).send({ name: 'Launch v2' }).expect(200)
    await member.delete(url).expect(403)
    await member.post(`${url}/members`).send({ email: 'outsider@example.com' }).expect(403)
    await owner.delete(url).expect(204)
  })

  it('answers 409 for adding someone twice', async () => {
    const { owner, url } = await scene()
    const again = await owner.post(`${url}/members`).send({ email: 'member@example.com' })
    expect(again.status).toBe(409)
  })

  it('keeps tasks inside the project', async () => {
    const { member, outsider, url } = await scene()
    const projectId = url.split('/').pop()
    const task = await member.post('/api/v1/tasks').send({ projectId, title: 'Ship' }).expect(201)

    await outsider.post('/api/v1/tasks').send({ projectId, title: 'Sneak' }).expect(404)
    await outsider.get(`/api/v1/tasks/${task.body.id}`).expect(404)
    await outsider.patch(`/api/v1/tasks/${task.body.id}`).send({ status: 'done' }).expect(404)
  })

  it('lists members with their roles', async () => {
    const { member, url } = await scene()
    const res = await member.get(`${url}/members`)
    expect(res.body.map((m: { email: string; role: string }) => [m.email, m.role])).toEqual([
      ['owner@example.com', 'owner'],
      ['member@example.com', 'member'],
    ])
  })
})
```

The last test depends on `orderBy('project_members.joinedAt')`. That's reliable because `defaultNow()` on SQLite stores milliseconds, so two rows inserted in the same second still sort in the order they were written.

<PmCommand exec="kick test" />

## What you built

- A membership table with a composite primary key, a role CHECK and cascading foreign keys.
- Access rules as contributors chained with `dependsOn`: `LoadMembership` (404 for outsiders) and `RequireOwner` (403 for members).
- A service method that writes two tables in one transaction, without passing a transaction object to the repository.
- A database constraint enforcing a rule — no duplicate members — that the API reports as `409` with no extra code.
- Tests that act as several users against one app.

**Next:** [Part 5: Attachments and Shipping](./5-attachments-shipping.md) — file uploads, cleanup after commit, and a production build.
