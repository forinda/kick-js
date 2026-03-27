---
title: "The Case for a tRPC-like Typed Client in KickJS"
published: false
description: "KickJS backends already define fully typed routes with Zod DTOs and Swagger decorators. Here's why a typed client generator would close the full-stack type safety loop — and what the DX should look like."
tags: kickjs, typescript, trpc, api-design, mongodb
series: "Building with KickJS"
cover_image: ""
---

## TL;DR

- Decorator-driven backends like KickJS already have all the metadata for a typed client: Zod DTOs, route decorators, Swagger annotations
- Frontend consumers currently write untyped `fetch()` calls, duplicating types manually — defeating the point of backend validation
- A `kick generate:client` command could produce a tRPC-like typed API client from existing route and DTO metadata
- Combined with KickJS's `SpaAdapter`, this enables a full-stack monorepo with end-to-end type safety
- The ideal DX: `api.tasks.create({ title: 'Fix bug', priority: 'high' })` with full autocomplete and type checking

---

## The Problem: Types Stop at the API Boundary

Building Vibed — a Jira-like task management backend — I ended up with some of the most well-typed backend code I've ever written. Every route has Zod validation. Every request body and query parameter is schema-validated before the handler sees it. Every response is typed through Swagger annotations.

Here's what a typical controller method looks like:

```typescript
@Post('/projects/:projectId/tasks', {
  params: z.object({ projectId: z.string() }),
  body: createTaskSchema,
})
@Middleware(projectAccessGuard)
@ApiOperation({ summary: 'Create a new task in a project' })
@ApiResponse({ status: 201, description: 'Task created successfully' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiQueryParams(TASK_QUERY_CONFIG)
async create(ctx: RequestContext) {
  const user = ctx.get('user');
  const result = await this.createTaskUseCase.execute(
    ctx.params.projectId,
    user.id,
    ctx.body,
  );
  ctx.created(successResponse(result, 'Task created'));
}
```

The `createTaskSchema` is a Zod schema:

```typescript
import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  status: z.string().default('todo'),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).default('none'),
  assigneeIds: z.array(z.string()).default([]),
  labelIds: z.array(z.string()).default([]),
  parentTaskId: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  estimatePoints: z.number().int().positive().optional(),
});

export type CreateTaskDto = z.infer<typeof createTaskSchema>;
```

The query config defines filterable, sortable, and searchable fields:

```typescript
export const TASK_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['status', 'priority', 'assigneeId', 'labelId', 'projectId'],
  sortable: ['createdAt', 'title', 'priority', 'dueDate', 'orderIndex'],
  searchable: ['title', 'description'],
};
```

All of this metadata exists. It's precise. It's validated at runtime. And then what happens on the frontend?

```typescript
// Frontend code — no types, no autocomplete, no safety
const response = await fetch('/api/v1/projects/123/tasks', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    title: 'Fix bug',
    priorty: 'high', // typo — no one catches this until runtime
  }),
});
const data = await response.json(); // any
```

There's a typo in `priorty`. TypeScript doesn't catch it. The API returns a 400 validation error at runtime. We have Zod on the backend specifically to prevent this kind of mistake, but the safety doesn't extend to the consumer.

This is the gap. The types exist. They're just trapped on the server.

---

## What Others Have Solved

This isn't a new problem. Several frameworks have built solutions:

### tRPC — The Gold Standard

tRPC shares the router type directly between server and client with zero code generation:

```typescript
// Server
const appRouter = router({
  tasks: {
    create: procedure.input(createTaskSchema).mutation(({ input }) => { ... }),
  },
});
export type AppRouter = typeof appRouter;

// Client — fully typed, inferred from AppRouter
const task = await trpc.tasks.create.mutate({ title: 'Fix bug', priority: 'high' });
```

The downside: tRPC requires both server and client to be TypeScript, and the server must use tRPC's router abstraction. Decorator-driven frameworks like KickJS, NestJS, or Hono define routes differently.

### Hono RPC

Hono takes a similar approach with `hc<AppType>()`:

```typescript
const client = hc<AppType>('http://localhost:3000');
const res = await client.api.tasks.$post({ json: { title: 'Fix bug' } });
```

This works because Hono's route definitions carry type information through method chaining. But again, it requires the Hono-specific route definition pattern.

### Nuxt `$fetch`

Nuxt auto-types `$fetch` calls based on the `server/api/` file structure. If `server/api/tasks.post.ts` exists, `$fetch('/api/tasks', { method: 'POST' })` is fully typed. The framework controls both the server and the client, so it can bridge the gap.

### OpenAPI Generator

The most universal approach: generate a client from the OpenAPI/Swagger spec. Language-agnostic, works with any API. But the generated code is verbose, the types are often loosely inferred from JSON Schema, and it requires a separate generation step.

---

## What KickJS Already Has

Here's what makes a typed client for KickJS particularly feasible: the framework already collects all the metadata needed. It just doesn't expose it to a client generator.

**Route decorators** define method and path:

```typescript
@Post('/projects/:projectId/tasks', {
  params: z.object({ projectId: z.string() }),
  body: createTaskSchema,
})
```

From this, a generator knows: `POST`, path `/projects/:projectId/tasks`, path parameter `projectId: string`, request body typed as `CreateTaskDto`.

**Swagger decorators** add response types:

```typescript
@ApiOperation({ summary: 'Create a new task in a project' })
@ApiResponse({ status: 201, description: 'Task created successfully' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
```

**Query param configs** define the filter/sort/search contract:

```typescript
@ApiQueryParams(TASK_QUERY_CONFIG)
// Where TASK_QUERY_CONFIG = {
//   filterable: ['status', 'priority', 'assigneeId', 'labelId', 'projectId'],
//   sortable: ['createdAt', 'title', 'priority', 'dueDate', 'orderIndex'],
//   searchable: ['title', 'description'],
// }
```

**Module routes** define the URL prefix:

```typescript
routes(): ModuleRoutes {
  return {
    path: '/',
    router: buildRoutes(TasksController),
    controller: TasksController,
  };
}
```

And the **SwaggerAdapter** already aggregates all of this into an OpenAPI spec served at `/api-docs`. The metadata pipeline exists end to end. It just outputs a Swagger UI page instead of a typed client.

---

## The Proposed Solution: `kick generate:client`

Here's what I think this should look like as a CLI command:

```bash
kick generate:client --out ./client
```

This would scan the codebase — reading decorator metadata from controllers, Zod schemas from DTOs, and route configurations from modules — then produce a typed TypeScript client package.

### What the Generator Would Read

| Source | What It Extracts |
|--------|-----------------|
| `@Get('/')`, `@Post('/')`, etc. | HTTP method + path |
| Route option `{ body: schema }` | Request body type (from Zod) |
| Route option `{ params: schema }` | Path parameter types |
| Route option `{ query: schema }` | Query parameter types |
| `@ApiResponse({ status, schema })` | Response type |
| `@ApiQueryParams(config)` | Filterable/sortable/searchable fields |
| Module `routes()` path | URL prefix for grouping |

### What It Would Produce

A TypeScript file (or package) with a typed client factory:

```typescript
// Generated: client/index.ts
import { createClient } from '@forinda/kickjs-client';

export interface AppRoutes {
  auth: {
    register: {
      method: 'POST';
      path: '/auth/register';
      body: { email: string; password: string; firstName: string; lastName: string };
      response: { accessToken: string; refreshToken: string; user: User };
    };
    login: {
      method: 'POST';
      path: '/auth/login';
      body: { email: string; password: string };
      response: { accessToken: string; refreshToken: string; user: User };
    };
  };
  tasks: {
    create: {
      method: 'POST';
      path: '/projects/:projectId/tasks';
      params: { projectId: string };
      body: CreateTaskDto;
      response: TaskResponse;
    };
    list: {
      method: 'GET';
      path: '/projects/:projectId/tasks';
      params: { projectId: string };
      query: { status?: string; priority?: string; sort?: string; limit?: number };
      response: PaginatedResponse<TaskResponse>;
    };
  };
  // ... all other routes
}
```

---

## What the DX Should Look Like

Here's the experience I want on the frontend:

```typescript
import { createApiClient } from '@vibed/api-client';

const api = createApiClient({
  baseUrl: '/api/v1',
  token: accessToken,
});

// Body typed as CreateTaskDto, response typed as TaskResponse
const { data: task } = await api.tasks.create({
  params: { projectId: 'proj_123' },
  body: {
    title: 'Implement feature',
    priority: 'high',
    assigneeIds: ['user_456'],
  },
});
// task is typed as TaskResponse — autocomplete for task.key, task.status, etc.

// Query params typed from ApiQueryParamsConfig
const { data: tasks, meta } = await api.tasks.list({
  params: { projectId: 'proj_123' },
  query: { status: 'open', sort: '-createdAt', limit: 20 },
});
// meta is typed as { page, limit, total, totalPages, hasNext, hasPrev }

// Path params typed from route definition
const { data: workspace } = await api.workspaces.getById({
  params: { workspaceId: 'ws_789' },
});

// Auth handled automatically via the token in createApiClient
const { data: me } = await api.users.me();
```

Key properties of this DX:

1. **Autocomplete everywhere** — `api.tasks.` shows all available task operations, `.body` shows all valid fields, `.query` shows filterable/sortable fields
2. **Compile-time errors for typos** — `priorty` instead of `priority` is caught by TypeScript, not by a 400 response at runtime
3. **Path params are required** — calling `api.tasks.create()` without `params.projectId` is a type error
4. **Response types are exact** — `task.key` is typed as `string`, `task.orderIndex` is typed as `number`, no `any` casting
5. **Pagination is typed** — list endpoints return `{ data: T[], meta: PaginationMeta }` automatically

---

## Synergy with SpaAdapter

KickJS already has a `SpaAdapter` that serves Single Page Applications from the same server. Combined with a typed client, this enables a full-stack monorepo that's hard to beat:

```
vibed/
├── src/                       # KickJS backend
│   └── modules/
│       ├── tasks/
│       │   ├── application/
│       │   │   └── dtos/
│       │   │       └── create-task.dto.ts    # Zod schema (source of truth)
│       │   └── presentation/
│       │       └── tasks.controller.ts       # Route decorators
│       └── ...
├── client/                    # Generated typed API client
│   └── index.ts               # kick generate:client output
└── frontend/                  # SPA (React, Vue, Svelte)
    └── src/
        └── api.ts             # import { createApiClient } from '../../client'
```

The workflow:

```bash
kick new my-app --spa react    # Scaffold full-stack project
kick dev                       # HMR for backend + frontend
kick generate:client           # Regenerate client after route changes
kick build                     # Build everything for production
```

One server. One deploy. One type system. The backend defines the API contract via Zod and decorators. The client is generated from that contract. The frontend imports the client. No API boundary to manually bridge.

---

## Two Implementation Approaches

### Option A: Build-Time Extraction (Recommended)

Scan controller files at build time, extract decorator metadata and Zod schemas via TypeScript's compiler API, and generate a typed client package. This is what `kick generate:client` would do.

Pros: Works with any frontend framework. No runtime overhead. Client can be published as an npm package for external consumers.

Cons: Requires a generation step. Client can drift from server if you forget to regenerate.

### Option B: Runtime from OpenAPI

Since `SwaggerAdapter` already generates an OpenAPI spec, generate the client from that spec. This is essentially what tools like `openapi-typescript` do.

```bash
kick generate:client --from openapi --out ./client
```

Pros: Leverages existing OpenAPI generation. Works with any OpenAPI-compatible tooling.

Cons: OpenAPI types are looser than Zod types (JSON Schema vs TypeScript). Loses some of the precision that Zod provides.

I'd lean toward Option A because the whole point is leveraging the Zod schemas directly. Going through OpenAPI is a lossy conversion — you're serializing TypeScript types to JSON Schema and then deserializing them back. With direct extraction, `CreateTaskDto` on the client is literally `z.infer<typeof createTaskSchema>` from the server.

---

## What's Missing Today

For this to work, KickJS would need to:

1. **Expose decorator metadata programmatically** — Currently, `@Get`, `@Post`, etc. store metadata on the class for the router builder. A client generator needs to read this same metadata.

2. **Support response type decorators** — `@ApiResponse` currently takes a description string. It would need to accept a Zod schema or TypeScript type for the response body.

3. **Provide a client runtime** — A lightweight `createClient<Routes>()` function that takes the generated type and produces a typed fetch wrapper. This handles auth headers, base URL, error handling, and serialization.

4. **Integrate into the dev workflow** — Ideally, `kick dev` watches for route changes and regenerates the client automatically. No manual `kick generate:client` step needed during development.

The first two are metadata changes. The third is a small package (`@forinda/kickjs-client`). The fourth is tooling around file watching, which KickJS already does for HMR.

---

## A Minimal Version You Can Build Today

While waiting for official support, here's a practical approach that gets you 80% of the way:

Create a shared types package that exports your Zod schemas:

```typescript
// shared/api-types.ts
export { createTaskSchema, type CreateTaskDto } from '../modules/tasks/application/dtos/create-task.dto';
export { updateTaskSchema, type UpdateTaskDto } from '../modules/tasks/application/dtos/update-task.dto';
export { registerSchema, type RegisterDto } from '../modules/auth/application/dtos/register.dto';
export { loginSchema, type LoginDto } from '../modules/auth/application/dtos/login.dto';
// ... export all DTOs
```

Then build a typed fetch wrapper on the frontend:

```typescript
// frontend/src/api.ts
import type { CreateTaskDto } from '../../shared/api-types';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

async function post<TBody, TResponse>(
  path: string,
  body: TBody,
  token: string,
): Promise<ApiResponse<TResponse>> {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Usage — typed body, but manual path
const result = await post<CreateTaskDto, TaskResponse>(
  '/projects/123/tasks',
  { title: 'Fix bug', priority: 'high' },
  token,
);
```

This gives you typed request bodies (from the shared Zod schemas) but not typed paths, params, or responses. It's a stepping stone, not the destination.

---

## Why This Matters for the Ecosystem

Decorator-driven frameworks — KickJS, NestJS, Ts.ED, Hono — are increasingly popular because they let you define rich metadata directly on your route handlers. Zod validation ensures that metadata is precise and runtime-enforced. But if that precision stops at the API boundary, you're leaving half the value on the table.

The frameworks that win the next wave of TypeScript adoption will be the ones that close this loop. tRPC proved the DX is possible. The question is whether decorator-driven frameworks can offer the same safety without requiring developers to abandon their preferred patterns.

KickJS already collects the metadata. It already has `SpaAdapter` for serving frontends. It already has `SwaggerAdapter` for API documentation. A typed client generator would be the third leg of the full-stack stool — turning a backend framework into a full-stack platform.

I've filed this as [KICK-018](./framework-filed-issues/KICK-018.md) in the framework issue tracker. If you're building with KickJS and want this feature, add a thumbs up on the GitHub issue.

---

*This is part of a series on building a Jira-like backend with KickJS. Next up: implementing real-time typing indicators and presence tracking with Socket.IO rooms.*
