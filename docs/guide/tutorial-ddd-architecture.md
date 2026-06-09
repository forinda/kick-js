# REST Module Architecture with a Decorator-Driven Framework

_Part of "Building a Jira Clone with KickJS"_

---

A real app has many feature modules — tasks, projects, comments, users — and they all
benefit from following the same shape. KickJS's generators scaffold that shape for you:
a **flat REST module** where a controller delegates to a service, the service depends on a
repository _interface_, and a concrete repository implementation is wired in via a DI token.

This article walks through that layout end to end. We'll scaffold a `task` module, read
every file the generator emits, trace the dependency flow, then swap the default in-memory
repository for a real database implementation — without touching the controller or service.

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
├── task.repository.ts          # Repository INTERFACE + DI token
├── in-memory-task.repository.ts # Default repository implementation (a Map)
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

::: tip Why "program to an interface"?
The service depends on `ITaskRepository`, not on `InMemoryTaskRepository`. That single
indirection is what lets you start with a zero-dependency in-memory store and later drop in
a real database (e.g. `@forinda/kickjs-db`) without editing a line of the controller or
service. We'll do exactly that at the end of this guide.
:::

## Scaffolding a Module

Creating this structure by hand for a dozen modules would be tedious and error-prone. The
fastest path is `kick g scaffold`, which generates the same flat layout as `kick g module`
but builds the DTOs from `<field>:<type>` definitions instead of leaving empty stubs:

```bash
kick g scaffold task title:string done:boolean
```

This writes the module under `src/modules/tasks/` and auto-registers it in
`src/modules/index.ts` so it's mounted on the next dev-server restart.

::: tip Always pass the singular name
`kick g scaffold task` creates `src/modules/tasks/`. The generator pluralizes the folder and
route prefix for you. Pass the singular noun.
:::

Supported field types include `string`, `text`, `number`, `int`, `float`, `boolean`, `date`,
`email`, `url`, `uuid`, `json`, and `enum:a,b,c`. Mark a field optional with a trailing
`:optional` segment (shell-safe — no quoting needed):

```bash
kick g scaffold post title:string body:text:optional published:boolean:optional
```

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
import { TASK_REPOSITORY } from './task.repository'
import { InMemoryTaskRepository } from './in-memory-task.repository'
import { TaskController } from './task.controller'

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(['./**/*.service.ts', './**/*.repository.ts', '!./**/*.test.ts'], { eager: true })

export const TaskModule = defineModule({
  name: 'TaskModule',
  build: () => ({
    register(container) {
      container.registerFactory(TASK_REPOSITORY, () => container.resolve(InMemoryTaskRepository))
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
asks for the task repository interface, hand it the in-memory implementation." This is the
**only** line you change to swap databases.

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
**token + interface**, never the concrete class:

```ts
// src/modules/tasks/task.service.ts
import { Service, Inject } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import { TASK_REPOSITORY, type ITaskRepository } from './task.repository'
import type { TaskResponseDTO } from './dtos/task-response.dto'
import type { CreateTaskDTO } from './dtos/create-task.dto'
import type { UpdateTaskDTO } from './dtos/update-task.dto'

@Service()
export class TaskService {
  constructor(@Inject(TASK_REPOSITORY) private readonly repo: ITaskRepository) {}

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

### The repository interface + DI token

`task.repository.ts` defines **what** data operations exist, with no hint of **how**. It also
exports the DI token that binds the interface to its implementation:

```ts
// src/modules/tasks/task.repository.ts
import { createToken } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { TaskResponseDTO } from './dtos/task-response.dto'
import type { CreateTaskDTO } from './dtos/create-task.dto'
import type { UpdateTaskDTO } from './dtos/update-task.dto'

export interface ITaskRepository {
  findById(id: string): Promise<TaskResponseDTO | null>
  findAll(): Promise<TaskResponseDTO[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: TaskResponseDTO[]; total: number }>
  create(dto: CreateTaskDTO): Promise<TaskResponseDTO>
  update(id: string, dto: UpdateTaskDTO): Promise<TaskResponseDTO>
  delete(id: string): Promise<void>
}

// Collision-safe DI token bound to `ITaskRepository`.
// `container.resolve(TASK_REPOSITORY)` and `@Inject(TASK_REPOSITORY)`
// both return the typed interface — no manual generic, no `any` cast.
export const TASK_REPOSITORY = createToken<ITaskRepository>('app/Task/repository')
```

`createToken<T>` returns a frozen, reference-identified token that carries its type
parameter. That's what makes `@Inject(TASK_REPOSITORY) repo: ITaskRepository` type-safe with
no cast, and what prevents the classic "two `Symbol('TaskRepository')` calls produce two
different symbols" bug. See [Dependency Injection](./dependency-injection.md) for the full
token hierarchy (class identity → `createToken<T>` → symbol → raw string).

::: tip One token per interface
The generator declares exactly one token per repository interface and exports it from the
same file. Import that token everywhere you need the repository — never declare a parallel
`Symbol()` or a centralized `TOKENS` map. A single source of truth is what keeps the binding
unambiguous across HMR reloads and cross-module injection.
:::

### The in-memory implementation — the default

`in-memory-task.repository.ts` fulfills the contract with a plain `Map`. It carries zero
dependencies, so a freshly scaffolded module runs and passes its tests immediately:

```ts
// src/modules/tasks/in-memory-task.repository.ts
import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { ITaskRepository } from './task.repository'
import type { TaskResponseDTO } from './dtos/task-response.dto'
import type { CreateTaskDTO } from './dtos/create-task.dto'
import type { UpdateTaskDTO } from './dtos/update-task.dto'

@Repository()
export class InMemoryTaskRepository implements ITaskRepository {
  private store = new Map<string, TaskResponseDTO>()

  async findById(id: string): Promise<TaskResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<TaskResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: TaskResponseDTO[]; total: number }> {
    const all = Array.from(this.store.values())
    const data = all.slice(
      parsed.pagination.offset,
      parsed.pagination.offset + parsed.pagination.limit,
    )
    return { data, total: all.length }
  }

  async create(dto: CreateTaskDTO): Promise<TaskResponseDTO> {
    const now = new Date().toISOString()
    const entity: TaskResponseDTO = {
      id: randomUUID(),
      ...dto,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: UpdateTaskDTO): Promise<TaskResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('Task not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('Task not found')
    this.store.delete(id)
  }
}
```

`@Repository()` registers the class in the DI container as a singleton (it's semantically the
same as `@Service()`, just clearer about intent). The module's `register()` then routes the
`TASK_REPOSITORY` token to this class.

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
TaskController        depends on →  TaskService           (concrete class, @Autowired)
   │
   ▼
TaskService           depends on →  ITaskRepository        (interface, via TASK_REPOSITORY token)
   │
   ▼
TASK_REPOSITORY  ──bound in module's register()──►  InMemoryTaskRepository  (implements ITaskRepository)
```

The controller knows nothing about the database. The service knows nothing about _which_
database — only the `ITaskRepository` contract. The single arrow that crosses into "how data
is actually stored" is the `registerFactory` call in `task.module.ts`. That's the seam you
exploit to swap implementations.

## Swapping the In-Memory Repo for a Real Database

The in-memory store is perfect for prototyping and tests, but eventually you need persistence.
Because everything above the repository depends on the _interface_, switching is a localized
change. There are two steps.

### 1. Write a new implementation of the same interface

Generate a custom stub by passing any database name as the repo. Anything other than
`inmemory` scaffolds a generic custom repository file with TODOs:

```bash
kick g module task --repo postgres
```

That writes `postgres-task.repository.ts` — a stub that already `implements ITaskRepository`
and is decorated with `@Repository()`. Fill in the TODOs with your real client calls:

```ts
// src/modules/tasks/postgres-task.repository.ts
import { Repository, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { ITaskRepository } from './task.repository'
import type { TaskResponseDTO } from './dtos/task-response.dto'
import type { CreateTaskDTO } from './dtos/create-task.dto'
import type { UpdateTaskDTO } from './dtos/update-task.dto'
import { db } from '../../db' // your own client

@Repository()
export class PostgresTaskRepository implements ITaskRepository {
  async findById(id: string): Promise<TaskResponseDTO | null> {
    const row = await db.query('SELECT * FROM tasks WHERE id = $1', [id])
    return row ?? null
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: TaskResponseDTO[]; total: number }> {
    // Use parsed.pagination, parsed.filters, parsed.sort, parsed.search here
    // ...
    return { data, total }
  }

  // ...create / update / delete, implementing the same contract
}
```

Because TypeScript checks `implements ITaskRepository`, you can't accidentally drift from the
contract — a missing or mistyped method is a compile error.

::: warning Implement the whole interface
The new class must satisfy every method on `ITaskRepository`. The interface is your safety
net: if a method's signature doesn't match, the build fails before runtime.
:::

### 2. Re-point the token in the module

Change the one binding in `task.module.ts` to resolve the new class:

```ts
// src/modules/tasks/task.module.ts
import { PostgresTaskRepository } from './postgres-task.repository'

// ...inside build().register(container):
container.registerFactory(TASK_REPOSITORY, () => container.resolve(PostgresTaskRepository))
```

That's it. The controller, service, DTOs, and query config are untouched. Every consumer that
injects `TASK_REPOSITORY` now receives the Postgres-backed implementation. You can even keep
both classes in the tree and switch per environment — in-memory for tests, Postgres for
production.

::: tip Pick persistence by name
`--repo inmemory` (the default) gives you the zero-dependency working impl; any other name
(e.g. `--repo postgres`) gives you the generic stub above to wire to whatever client you
prefer. For a first-party database layer, reach for `@forinda/kickjs-db`.
:::

## Running and Testing

Start the dev server and the module is live under its route prefix:

```bash
kick dev
```

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

The scaffolded tests (generated by `kick g module`) exercise the repository directly against
the in-memory implementation — no HTTP, no database, fast to run:

```ts
// src/modules/tasks/__tests__/task.repository.test.ts (excerpt)
import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryTaskRepository } from '../in-memory-task.repository'

describe('InMemoryTaskRepository', () => {
  let repo: InMemoryTaskRepository

  beforeEach(() => {
    repo = new InMemoryTaskRepository()
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

Because the repository is just a class implementing an interface, you can unit-test it in
isolation, and you can hand a fresh `InMemoryTaskRepository` to a service in a test without
spinning up a database — the same indirection that lets you swap Postgres in production lets
you swap the fast in-memory store in tests.

## Next Up

In [Query Parsing & Pagination](./tutorial-query-pagination.md), we'll dig into the
`QueryFieldConfig` pattern that drives the list endpoint — how `filterable`, `sortable`, and
`searchable` translate incoming query strings into the `ParsedQuery` your repository receives,
and how `ctx.paginate()` wires it all together.
