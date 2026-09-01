# REST Module Architecture with a Decorator-Driven Framework

_Part of "Building a Jira Clone with KickJS"_

---

A real app has many feature modules — tasks, projects, comments, users — and they all
benefit from following the same shape. KickJS's generators scaffold that shape for you:
a **flat REST module** where a controller delegates to a service, the service depends on a
repository _contract_, and the concrete repository is wired in via a DI token.

This article walks through that layout end to end. We'll scaffold a `task` module, read
every file the generator emits, trace the dependency flow, then swap the default in-memory
store for a real database — without touching the controller or service.

## The Module Structure

Every feature module the generator writes lives under `src/modules/<plural>/` as a **flat
folder**. There are no nested `presentation/`, `application/`, `domain/`, or
`infrastructure/` directories — each file's role is obvious from its name:

```
src/modules/tasks/
├── task.module.ts              # Module registration + routes
├── task.controller.ts          # HTTP endpoints (CRUD)
├── task.service.ts             # Business logic
├── task.constants.ts           # Query config (filter/sort/search fields)
├── task.repository.ts          # Repository: factory, derived contract, DI token
├── dtos/
│   ├── create-task.dto.ts      # Zod schema + Create DTO type
│   ├── update-task.dto.ts      # Zod schema + Update DTO type
│   └── task-response.dto.ts    # Response shape
└── __tests__/
    ├── task.controller.test.ts
    └── task.repository.test.ts
```

Nothing in KickJS _forces_ this shape — it's the convention the REST generator picks because
it maps cleanly onto three responsibilities, top to bottom:

- **Controller** — translates HTTP into service calls. No business logic, no data access.
- **Service** — orchestrates operations. Validates, calls the repository, returns results.
- **Repository** — the data-access contract. An _interface_ plus a swappable implementation.

The golden rule that keeps these honest: **each layer depends only on the layer directly
below it, and the repository is consumed through an interface — never a concrete class.**

::: tip Why "program to a contract"?
The service depends on the `TaskRepository` type and the `TASK_REPOSITORY` token — never on a
particular store. That single indirection is what lets you start with a zero-dependency
in-memory store and later drop in a real database (e.g. `@forinda/kickjs-db`) without editing
a line of the controller or service. We'll do exactly that at the end of this guide.

Note the contract is _derived_, not declared: `type TaskRepository = ReturnType<typeof
createTaskRepository>`. There is no hand-written interface to keep in step with the
implementation, so the two cannot drift apart.
:::

## Scaffolding a Module

Creating this structure by hand for a dozen modules would be tedious and error-prone. The
fastest path is `kick g scaffold`, which generates the same flat layout as `kick g module`
but builds the DTOs from `<field>:<type>` definitions instead of leaving empty stubs:

<PmCommand exec="kick g scaffold task title:string done:boolean" />

This writes the module under `src/modules/tasks/` and auto-registers it in
`src/modules/index.ts` so it's mounted on the next dev-server restart.

::: tip Always pass the singular name
`kick g scaffold task` creates `src/modules/tasks/`. The generator pluralizes the folder and
route prefix for you. Pass the singular noun.
:::

Supported field types include `string`, `text`, `number`, `int`, `float`, `boolean`, `date`,
`email`, `url`, `uuid`, `json`, and `enum:a,b,c`. Mark a field optional with a trailing
`:optional` segment (shell-safe — no quoting needed):

<PmCommand exec="kick g scaffold post title:string body:text:optional published:boolean:optional" />

If you don't have fields in mind yet, `kick g module task` produces the identical structure
with a single placeholder `name` field you fill in later. See
[Generators](./generators.md) for the full command reference and
[Project Structure](./project-structure.md) for where everything lands.

## Reading the Generated Files

Let's walk the module top to bottom and see how the layers connect.

### The module file — wiring it all together

`task.module.ts` is the composition root. It binds the repository token to a concrete
implementation in `register()` and declares the route prefix in `routes()`:

```ts
// src/modules/tasks/task.module.ts
import { defineModule } from '@forinda/kickjs'
import { TASK_REPOSITORY, createTaskRepository } from './task.repository'
import { TaskController } from './task.controller'

// Eagerly load every module file so decorators (@Controller / @Service, and anything you
// add) register in the DI container. The glob is deliberately broad — a suffix list missed
// hand-written *.usecase.ts / *.policy.ts files, which then failed as `No provider for X`.
import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./**/*.d.ts'], { eager: true })

export const TaskModule = defineModule({
  name: 'TaskModule',
  build: () => ({
    register(container) {
      container.registerFactory(TASK_REPOSITORY, () => createTaskRepository())
    },

    routes() {
      return {
        path: '/tasks',
        controller: TaskController,
      }
    },
  }),
})
```

The `registerFactory(TASK_REPOSITORY, …)` line is the single place that says "when something
asks for the task repository, call this factory." This is the **only** line you change to
point at a different store.

### The controller — HTTP in, service calls out

`task.controller.ts` exposes the five CRUD endpoints and delegates each to the service. It
holds no business logic:

```ts
// src/modules/tasks/task.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Autowired,
  ApiQueryParams,
  type Ctx,
} from '@forinda/kickjs'
import { ApiTags } from '@forinda/kickjs-swagger'
import { TaskService } from './task.service'
import { createTaskSchema } from './dtos/create-task.dto'
import { updateTaskSchema } from './dtos/update-task.dto'
import { TASK_QUERY_CONFIG } from './task.constants'

@Controller()
export class TaskController {
  @Autowired() private readonly taskService!: TaskService

  @Get('/')
  @ApiTags('Task')
  @ApiQueryParams(TASK_QUERY_CONFIG)
  async list(ctx: Ctx<KickRoutes.TaskController['list']>) {
    return ctx.paginate((parsed) => this.taskService.findPaginated(parsed), TASK_QUERY_CONFIG)
  }

  @Get('/:id')
  @ApiTags('Task')
  async getById(ctx: Ctx<KickRoutes.TaskController['getById']>) {
    const result = await this.taskService.findById(ctx.params.id)
    if (!result) return ctx.notFound('Task not found')
    ctx.json(result)
  }

  @Post('/', { body: createTaskSchema, name: 'CreateTask' })
  @ApiTags('Task')
  async create(ctx: Ctx<KickRoutes.TaskController['create']>) {
    const result = await this.taskService.create(ctx.body)
    ctx.created(result)
  }

  @Put('/:id', { body: updateTaskSchema, name: 'UpdateTask' })
  @ApiTags('Task')
  async update(ctx: Ctx<KickRoutes.TaskController['update']>) {
    const result = await this.taskService.update(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  @ApiTags('Task')
  async remove(ctx: Ctx<KickRoutes.TaskController['remove']>) {
    await this.taskService.delete(ctx.params.id)
    ctx.noContent()
  }
}
```

A few things worth noting:

- `@Autowired()` injects the `TaskService` by class identity — no token needed, because the
  service is a concrete class registered by its own `@Service()` decorator.
- `@Post('/', { body: createTaskSchema })` validates the request body against the Zod schema
  before your handler runs, and feeds the OpenAPI spec when `SwaggerAdapter` is mounted.
- The `Ctx<KickRoutes.TaskController['list']>` annotation gives you fully typed
  `ctx.params`, `ctx.body`, and `ctx.query`. The `KickRoutes` namespace is generated by
  `kick typegen` (auto-run on `kick dev`) — see [Type Generation](./typegen.md).

### The service — business logic, depends on the interface

`task.service.ts` is where logic lives. Crucially, it injects the repository through the
**token + derived contract**, never a concrete store:

```ts
// src/modules/tasks/task.service.ts
import { Service, Inject } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import { TASK_REPOSITORY, type TaskRepository } from './task.repository'
import type { TaskResponseDTO } from './dtos/task-response.dto'
import type { CreateTaskDTO } from './dtos/create-task.dto'
import type { UpdateTaskDTO } from './dtos/update-task.dto'

@Service()
export class TaskService {
  constructor(@Inject(TASK_REPOSITORY) private readonly repo: TaskRepository) {}

  async findById(id: string): Promise<TaskResponseDTO | null> {
    return this.repo.findById(id)
  }

  async findAll(): Promise<TaskResponseDTO[]> {
    return this.repo.findAll()
  }

  async findPaginated(parsed: ParsedQuery) {
    return this.repo.findPaginated(parsed)
  }

  async create(dto: CreateTaskDTO): Promise<TaskResponseDTO> {
    return this.repo.create(dto)
  }

  async update(id: string, dto: UpdateTaskDTO): Promise<TaskResponseDTO> {
    return this.repo.update(id, dto)
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
```

Right now each method is a thin pass-through. That's the scaffold's starting point — this is
where you add real logic: derived fields, authorization checks, cross-entity coordination,
transactions. The point is that all of it lives _here_, behind a stable interface, not in the
controller and not in the database layer.

### The repository — factory, contract, and DI token in one file

`task.repository.ts` is a single file holding three things: a **factory** that builds the
store, the **contract** derived from that factory's return type, and the **DI token** typed
by the contract. There is no separate interface file and no second implementation file:

```ts
// src/modules/tasks/task.repository.ts
import { randomUUID } from 'node:crypto'
import { createToken, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { TaskResponseDTO } from './dtos/task-response.dto'
import type { CreateTaskDTO } from './dtos/create-task.dto'
import type { UpdateTaskDTO } from './dtos/update-task.dto'

export function createTaskRepository() {
  const store = new Map<string, TaskResponseDTO>()

  return {
    async findById(id: string): Promise<TaskResponseDTO | null> {
      return store.get(id) ?? null
    },

    async findAll(): Promise<TaskResponseDTO[]> {
      return [...store.values()]
    },

    async findPaginated(parsed: ParsedQuery): Promise<{ data: TaskResponseDTO[]; total: number }> {
      const all = [...store.values()]
      const { offset, limit } = parsed.pagination
      return { data: all.slice(offset, offset + limit), total: all.length }
    },

    async create(dto: CreateTaskDTO): Promise<TaskResponseDTO> {
      const now = new Date().toISOString()
      const entity = { id: randomUUID(), ...dto, createdAt: now, updatedAt: now } as TaskResponseDTO
      store.set(entity.id, entity)
      return entity
    },

    async update(id: string, dto: UpdateTaskDTO): Promise<TaskResponseDTO> {
      const existing = store.get(id)
      if (!existing) throw HttpException.notFound('Task not found')
      const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
      store.set(id, updated)
      return updated
    },

    async delete(id: string): Promise<void> {
      if (!store.has(id)) throw HttpException.notFound('Task not found')
      store.delete(id)
    },
  }
}

/** The contract, derived from the factory rather than declared beside it. */
export type TaskRepository = ReturnType<typeof createTaskRepository>

/** Collision-safe DI token bound to `TaskRepository`. */
export const TASK_REPOSITORY = createToken<TaskRepository>('app/Task/repository')
```

Three things are worth pausing on.

**The contract is derived.** `TaskRepository` is `ReturnType<typeof createTaskRepository>`, so
the implementation and its type cannot drift — there is no hand-written interface to forget to
update. Consumers still program against a name (`TaskRepository`), they just never maintain it.

**It is a closure, not a class.** `store` is private because it is a local variable, not
because a keyword says so, and each `createTaskRepository()` call gets a fresh one. That is
what makes the repository trivial to instantiate in a test.

**It always works as generated.** Even with `--repo postgres`, the body ships backed by a
`Map`. An earlier generation named that file `PostgresTaskRepository` while it was really a
`Map` — a name asserting a technology it did not implement, which an app could boot and smoke-test
on. With the store out of the name, an in-memory body is honest: this is the repository,
currently in memory, and the file's TODO says what to swap in.

`createToken<T>` returns a frozen, reference-identified token that carries its type parameter.
That's what makes `@Inject(TASK_REPOSITORY) repo: TaskRepository` type-safe with no cast, and
what prevents the classic "two `Symbol('TaskRepository')` calls produce two different symbols"
bug. See [Dependency Injection](./dependency-injection.md) for the full token hierarchy (class
identity → `createToken<T>` → symbol → raw string).

::: tip One token per repository
The generator declares exactly one token per repository and exports it from the same file as
the factory. Import that token everywhere you need the repository — never declare a parallel
`Symbol()` or a centralized `TOKENS` map. A single source of truth is what keeps the binding
unambiguous across HMR reloads and cross-module injection.
:::

### The DTOs — request and response shapes

Because we passed `title:string done:boolean`, the create/update schemas and response type
are generated from those fields:

```ts
// src/modules/tasks/dtos/create-task.dto.ts
import { z } from 'zod'

export const createTaskSchema = z.object({
  title: z.string(),
  done: z.boolean(),
})

export type CreateTaskDTO = z.infer<typeof createTaskSchema>
```

```ts
// src/modules/tasks/dtos/update-task.dto.ts
import { z } from 'zod'

export const updateTaskSchema = z.object({
  title: z.string().optional(),
  done: z.boolean().optional(),
})

export type UpdateTaskDTO = z.infer<typeof updateTaskSchema>
```

```ts
// src/modules/tasks/dtos/task-response.dto.ts
export interface TaskResponseDTO {
  id: string
  title: string
  done: boolean
  createdAt: string
  updatedAt: string
}
```

The update schema makes every field optional (PATCH-style partial updates), and the response
adds the server-owned `id`, `createdAt`, and `updatedAt`.

### Query config — filtering, sorting, search

`task.constants.ts` declares which fields the list endpoint allows clients to filter, sort,
and search on. The scaffold seeds it with a placeholder `name` field — update it to match
your real fields:

```ts
// src/modules/tasks/task.constants.ts
import type { QueryFieldConfig } from '@forinda/kickjs'

export const TASK_QUERY_CONFIG: QueryFieldConfig = {
  filterable: ['done'],
  sortable: ['title', 'createdAt'],
  searchable: ['title'],
}
```

This config is consumed by both `@ApiQueryParams()` (for OpenAPI docs) and `ctx.paginate()`
(to parse and apply the incoming query). We cover it in depth in the next part.

## The Dependency Flow

Put the pieces together and the direction of dependency is strictly one-way:

```
HTTP request
   │
   ▼
TaskController        depends on →  TaskService          (concrete class, @Autowired)
   │
   ▼
TaskService           depends on →  TaskRepository       (derived contract, via TASK_REPOSITORY token)
   │
   ▼
TASK_REPOSITORY  ──bound in module's register()──►  createTaskRepository()  (currently a Map)
```

The controller knows nothing about the database. The service knows nothing about _which_
database — only the `TaskRepository` contract. The single arrow that crosses into "how data is
actually stored" is the `registerFactory` call in `task.module.ts`. That's the seam you exploit
to swap implementations.

## Swapping the In-Memory Store for a Real Database

The in-memory store is perfect for prototyping and tests, but eventually you need persistence.
Because everything above the repository depends on the derived contract, switching is a
localized change. There are two ways to do it.

### Option 1 — replace the factory body

The simplest path, and the one the generator's TODOs point at: keep one factory, swap what it
returns.

```ts
// src/modules/tasks/task.repository.ts
import { createToken, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { TaskResponseDTO } from './dtos/task-response.dto'
import type { CreateTaskDTO } from './dtos/create-task.dto'
import type { UpdateTaskDTO } from './dtos/update-task.dto'
import { db } from '../../db' // your own client

export function createTaskRepository() {
  return {
    async findById(id: string): Promise<TaskResponseDTO | null> {
      const row = await db.query('SELECT * FROM tasks WHERE id = $1', [id])
      return row ?? null
    },

    async findPaginated(parsed: ParsedQuery): Promise<{ data: TaskResponseDTO[]; total: number }> {
      // Use parsed.pagination, parsed.filters, parsed.sort, parsed.search here
      // ...
      return { data, total }
    },

    // ...findAll / create / update / delete
  }
}

export type TaskRepository = ReturnType<typeof createTaskRepository>
export const TASK_REPOSITORY = createToken<TaskRepository>('app/Task/repository')
```

Nothing else in the module changes: `task.module.ts` still calls `createTaskRepository()`, and
the service still injects `TASK_REPOSITORY`.

::: warning Keep the return-type annotations
The contract is inferred from what the factory returns, so a method that loses its explicit
`Promise<TaskResponseDTO>` annotation silently widens the contract instead of failing. Annotate
every method's return type and the compiler catches drift at the call sites, exactly like a
hand-written interface would.
:::

### Option 2 — a second factory, bound per environment

When you want the fast in-memory store in tests and Postgres in production, write a second
factory returning a compatible shape and pick between them in the module:

```ts
// src/modules/tasks/postgres-task.repository.ts
import type { TaskRepository } from './task.repository'

export function createPostgresTaskRepository(): TaskRepository {
  return {
    async findById(id) {
      return db.query('SELECT * FROM tasks WHERE id = $1', [id])
    },
    // ...the rest of the contract, backed by real queries
  }
}
```

```ts
// src/modules/tasks/task.module.ts — inside build().register(container):
container.registerFactory(TASK_REPOSITORY, () =>
  process.env.NODE_ENV === 'test' ? createTaskRepository() : createPostgresTaskRepository(),
)
```

The explicit `: TaskRepository` return annotation is what makes this safe — a missing or
mistyped method is a compile error in the new factory, not a surprise at runtime.

Either way the controller, service, DTOs, and query config are untouched. Every consumer that
injects `TASK_REPOSITORY` receives the new store.

::: tip Pick persistence by name
`--repo inmemory` (the default) and any other name (e.g. `--repo postgres`) emit the **same
single file** with the same working `Map` body — the store name only changes the prose and the
TODO markers telling you what to wire in. For a first-party database layer, reach for
`@forinda/kickjs-db`.
:::

## Running and Testing

Start the dev server and the module is live under its route prefix:

<PmCommand exec="kick dev" />

`kick dev` also runs `kick typegen` so the `KickRoutes` types stay in sync. Hit the endpoints:

```bash
# Create a task
curl -X POST http://localhost:3000/api/v1/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Write the docs","done":false}'

# List (paginated)
curl http://localhost:3000/api/v1/tasks

# Fetch one
curl http://localhost:3000/api/v1/tasks/<id>
```

The scaffolded tests (generated by `kick g module`, unless you passed `--no-tests`) exercise
the repository directly through its factory — no HTTP, no database, fast to run:

```ts
// src/modules/tasks/__tests__/task.repository.test.ts (excerpt)
import { describe, it, expect, beforeEach } from 'vitest'
import { createTaskRepository, type TaskRepository } from '../task.repository'

describe('Task repository', () => {
  let repo: TaskRepository

  beforeEach(() => {
    repo = createTaskRepository() // fresh Map per test — no shared state
  })

  it('should create and retrieve a task', async () => {
    const created = await repo.create({ title: 'Test Task', done: false })
    const found = await repo.findById(created.id)
    expect(found).toEqual(created)
  })
})
```

Run the suite:

```bash
pnpm test
```

Because the repository is just a function returning an object, you can unit-test it in
isolation, and you can hand a fresh `createTaskRepository()` to a service in a test without
spinning up a database — the same indirection that lets you swap Postgres in production lets
you swap the fast in-memory store in tests.

## Next Up

In [Query Parsing & Pagination](./tutorial-query-pagination.md), we'll dig into the
`QueryFieldConfig` pattern that drives the list endpoint — how `filterable`, `sortable`, and
`searchable` translate incoming query strings into the `ParsedQuery` your repository receives,
and how `ctx.paginate()` wires it all together.
