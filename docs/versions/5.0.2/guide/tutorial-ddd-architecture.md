# DDD Module Architecture with a Decorator-Driven Framework

_Part 2 of "Building a Task Management App with KickJS + Drizzle ORM"_

---

Vibed has 14 HTTP modules, a queue module, and a cron module. Each follows the same Domain-Driven Design structure. This article covers why we chose DDD, how it works with KickJS's decorator system, and the patterns that emerged.

## The Module Structure

Every module follows the same directory layout:

```
module/
├── index.ts                    # Module registration + routes
├── constants.ts                # Query config (DrizzleQueryParamsConfig)
├── presentation/
│   └── controller.ts           # HTTP endpoints
├── application/
│   ├── dtos/                   # Zod validation schemas
│   └── use-cases/              # Business logic orchestration
├── domain/
│   ├── repositories/           # Interfaces + DI symbols
│   ├── services/               # Domain rules
│   ├── entities/               # Type definitions
│   └── value-objects/          # Value object types
├── infrastructure/
│   └── repositories/           # Drizzle implementations
└── __tests__/                  # Test stubs
```

This isn't arbitrary structure — each layer has a specific role:

- **Presentation**: Translates HTTP into use case calls. No business logic.
- **Application**: Orchestrates operations. Thin — validates input, calls repos, returns results.
- **Domain**: Business rules that don't depend on HTTP or databases.
- **Infrastructure**: Database-specific code. The only layer that imports `drizzle-orm`.

## The Generator: `kick g module`

Creating this structure manually for 14 modules would be tedious and error-prone. KickJS's generator scaffolds it in one command:

```bash
kick g module task --pattern ddd --repo drizzle
```

This generates 18 files:

- Module index with DI registration and route declaration
- Controller with CRUD endpoints and Swagger decorators
- DTOs with Zod schemas
- 5 use cases (create, get, list, update, delete)
- Repository interface with DI symbol
- Drizzle repository implementation with `buildFromColumns()` pattern
- Domain service stub
- Entity and value object stubs
- 2 test files

The generator also auto-updates `src/modules/index.ts` to register the new module. This is easy to forget when creating modules manually — we learned to always stage `src/modules/index.ts` when committing a new module.

**Important**: Always pass the singular name. `kick g module task` creates `src/modules/tasks/`. The generator pluralizes automatically.

## v1.2.10 Generator Output

When we started with v1.2.8, the generator produced string-based query configs. After upgrading to v1.2.10, the scaffolded code improved significantly:

**Constants** — uses actual Drizzle Column objects:

```typescript
import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
// TODO: Import your schema table and reference actual columns
// import { tasks } from '@/db/schema'

export const TASK_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    // status: tasks.status,
    // priority: tasks.priority,
  },
  sortable: {
    // createdAt: tasks.createdAt,
  },
  searchColumns: [
    // tasks.title,
  ],
}
```

**Repository** — uses `buildFromColumns()` with the shared query adapter:

```typescript
const query = queryAdapter.buildFromColumns(parsed, TASK_QUERY_CONFIG)
```

The TODOs are clear — uncomment and point to your actual schema columns. Much better than guessing the API.

## After Generating: What You Change

The generator gives you a working skeleton. Here's what we changed for each module:

### 1. Constants — Fill in the columns

```typescript
import { tasks } from '@/db/schema'

export const TASK_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    projectId: tasks.projectId,
    status: tasks.status,
    priority: tasks.priority,
  },
  sortable: {
    title: tasks.title,
    createdAt: tasks.createdAt,
  },
  searchColumns: [tasks.title, tasks.key],
}
```

### 2. Repository interface — Use `$inferSelect` instead of manual DTOs

```typescript
import type { tasks } from '@/db/schema'

export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert

export interface ITaskRepository {
  findById(id: string): Promise<Task | null>
  findPaginated(parsed: ParsedQuery, projectId?: string): Promise<{ data: Task[]; total: number }>
  create(data: NewTask): Promise<Task>
  update(id: string, data: Partial<NewTask>): Promise<Task>
  delete(id: string): Promise<void>
}
```

### 3. Repository implementation — Replace stubs with real queries

The generator gives you `throw new Error('not implemented')`. Replace with actual Drizzle queries.

### 4. Use cases — Add business logic

The generator creates simple pass-throughs. Add your actual logic — mention parsing, counter increments, transaction handling.

### 5. Controller — Add auth middleware and adjust endpoints

The generator doesn't know about `authBridgeMiddleware`. Add it at the class level on every protected controller.

## The Shared QueryAdapter Pattern

Every Drizzle repository needs a `DrizzleQueryAdapter` instance with the same set of operators. After building 8 repositories, we realized we were duplicating 15 lines of imports every time:

```typescript
// This was in EVERY repository
import { eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc } from 'drizzle-orm'
import { DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'

const queryAdapter = new DrizzleQueryAdapter({
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  ilike,
  inArray,
  between,
  and,
  or,
  asc,
  desc,
})
```

We extracted it to a shared module:

```typescript
// src/shared/infrastructure/query-adapter.ts
import { eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc } from 'drizzle-orm'
import { DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'

export const queryAdapter = new DrizzleQueryAdapter({
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  ilike,
  inArray,
  between,
  and,
  or,
  asc,
  desc,
})
```

Now every repository imports just what it needs directly:

```typescript
import { eq, sql } from 'drizzle-orm' // only operators used in this file
import { queryAdapter } from '@/shared/infrastructure/query-adapter'
```

**Recommendation**: When generating a new module, immediately replace the scaffolded `DrizzleQueryAdapter` instantiation with the shared import.

## DI Token Strategy: One Token Per Interface

In earlier versions we hit an inconsistency during the build — some modules used a centralized `TOKENS` object, others declared module-local `Symbol()` instances. Because every `Symbol('CommentRepository')` call returns a _different_ symbol, code that injected `TOKENS.COMMENT_REPOSITORY` couldn't find a binding under the locally-declared `COMMENT_REPOSITORY`. Silent runtime failures, no compile-time signal.

**The current pattern, used by `kick g module` and `kick g scaffold` automatically**, is to declare one typed token per interface and import it everywhere it's needed:

```typescript
// src/modules/comments/domain/repositories/comment.repository.ts
import { createToken } from '@forinda/kickjs'

export interface ICommentRepository {
  findById(id: string): Promise<Comment | null>
  // ...
}

// One typed token, exported, imported everywhere it's needed.
// container.resolve(COMMENT_REPOSITORY) returns ICommentRepository directly —
// no manual generic, no `any` cast, no risk of two parallel symbols.
export const COMMENT_REPOSITORY = createToken<ICommentRepository>('Comment/Repository')
```

```typescript
// src/modules/comments/application/use-cases/get-comment.use-case.ts
import {
  COMMENT_REPOSITORY,
  type ICommentRepository,
} from '../../domain/repositories/comment.repository'

@Service()
export class GetCommentUseCase {
  constructor(@Inject(COMMENT_REPOSITORY) private readonly repo: ICommentRepository) {}
  // ↑ The type annotation is just documentation now —
  //   container.resolve(COMMENT_REPOSITORY) already returns ICommentRepository.
}
```

`createToken<T>` returns a frozen object identified by reference, so two import sites in different files share the same token instance regardless of how many times the file is re-evaluated under HMR. And because the token carries its `T` parameter, **cross-module guards and processors can reuse the same token without risking the `Symbol()` collision issue at all** — there's no parallel `TOKENS` object, no two-source-of-truth confusion.

See [DI Token Hardening](dependency-injection.md#di-token-hardening) for the full token hierarchy (class identity → `createToken<T>` → symbol → raw string).

## Modules Without Routes

Not every module has HTTP endpoints. Queue and cron modules only have background workers. The framework needs special handling:

**Queue module** — returns `null` from `routes()`. Added to the modules array. The `import.meta.glob` in its `index.ts` eagerly loads processor classes so `@Job()` decorators register.

**Cron module** — NOT in the modules array. Cron services are passed directly to `CronAdapter({ services: [...] })` in adapters. They're loaded via explicit imports in `config/adapters.ts`.

This distinction exists because Express will crash if you try to mount an `undefined` router. Returning `null` from `routes()` works in KickJS v1.2.3+, but the cron adapter has its own service registration path that doesn't need HTTP routing at all.

## Next Up

In [Part 3](/guide/tutorial-query-pagination), we'll dive deep into the `DrizzleQueryParamsConfig` pattern — how filtering, sorting, and pagination work with Column objects, and how we evolved the approach across three framework versions.
