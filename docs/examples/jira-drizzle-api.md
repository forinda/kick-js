# Jira Clone (Drizzle + PostgreSQL)

A full-featured project management API built with KickJS, PostgreSQL, and Drizzle ORM. This is the most comprehensive example in the repo — it exercises nearly every framework package.

## Features

- **14 DDD modules** — auth, users, workspaces, projects, tasks, labels, comments, attachments, channels, messages, notifications, activities, stats
- **PostgreSQL + Drizzle** — type-safe SQL with centralized schema definitions
- **JWT auth** — custom auth bridge middleware with refresh token rotation
- **Real-time** — WebSocket adapter for live updates, SSE for streaming
- **Background jobs** — BullMQ queues for email, notifications, activity logging
- **Cron jobs** — token cleanup, overdue reminders, health checks, daily digests, presence cleanup
- **Swagger UI** at `/docs`, **DevTools** at `/_debug`

## Running

```bash
cd examples/jira-drizzle-api

# Set up PostgreSQL and Redis connection
cp .env.example .env  # edit DATABASE_URL and REDIS_URL

# Run migrations
pnpm drizzle-kit migrate

# Start dev server
kick dev
```

## Packages Used

| Package | Purpose |
|---------|---------|
| `@forinda/kickjs` | DI, decorators, module system |
| `@forinda/kickjs` | Express 5, routing, middleware |
| `@forinda/kickjs-config` | Zod-based env validation |
| `@forinda/kickjs-swagger` | OpenAPI docs |
| `@forinda/kickjs-devtools` | Debug dashboard |
| `@forinda/kickjs-drizzle` | Drizzle adapter, DI integration |
| `@forinda/kickjs-queue` | BullMQ job processing |
| `@forinda/kickjs-cron` | Scheduled tasks |
| `@forinda/kickjs-mailer` | Email transport |
| `@forinda/kickjs-ws` | WebSocket adapter |

## Project Structure

```
src/
  index.ts                    # Bootstrap with all adapters
  config/
    adapters.ts               # Adapter instances (Drizzle, Swagger, WS, etc.)
    env.ts                    # Zod env schema
  db/
    index.ts                  # Drizzle connection
    schema/                   # Centralized schema definitions
      users.ts
      tasks.ts
      projects.ts
      workspaces.ts
      channels.ts
      messages.ts
      enums/                  # Shared enums (task-priority, workspace-role, etc.)
      base-columns.ts         # Shared createdAt/updatedAt
  modules/
    auth/                     # JWT login, register, refresh
    users/                    # User CRUD, profile
    workspaces/               # Workspace management, member roles
    projects/                 # Project CRUD with task counters
    tasks/                    # Task CRUD, assignees, auto-key generation
    labels/                   # Label CRUD, task-label associations
    comments/                 # Task comments
    attachments/              # File attachments
    channels/                 # Chat channels per workspace
    messages/                 # Channel messaging
    notifications/            # In-app notifications
    activities/               # Activity log (audit trail)
    stats/                    # Dashboard statistics
    queue/                    # BullMQ processors (email, notification, activity)
    cron/                     # Scheduled jobs
  shared/
    utils/                    # Response helpers, constants
```

Each module follows **Domain-Driven Design** layers:

```
modules/{name}/
  presentation/       # Controllers — HTTP handlers, no business logic
  application/        # Use cases (single execute() method) and DTOs (Zod schemas)
  domain/             # Entities, value objects, repository interfaces + DI tokens
  infrastructure/     # Drizzle repository implementations
  __tests__/          # Unit tests
```

## Key Patterns

### Authentication

Uses a custom auth bridge middleware rather than `@forinda/kickjs-auth`:

```ts
@Controller('/auth')
export class AuthController {
  @Autowired() private loginUseCase!: LoginUseCase
  @Autowired() private registerUseCase!: RegisterUseCase

  @Post('/login')
  async login(ctx: RequestContext) { ... }

  @Post('/register')
  async register(ctx: RequestContext) { ... }

  @Post('/refresh')
  async refresh(ctx: RequestContext) { ... }
}
```

Protected routes use `@Middleware(authBridge)` at the controller level.

### Task Key Generation

Tasks get auto-incremented keys per project (e.g., `PROJ-123`):

```ts
// domain/services/task-domain.service.ts
const counter = await this.getNextCounter(projectId)
const key = `${project.key}-${counter}`
```

### Query Parsing

Controllers use `ctx.paginate()` with field configs for filtering and sorting:

```ts
@Get('/')
@Middleware(authBridge)
async list(ctx: RequestContext) {
  const query = ctx.qs(QUERY_CONFIG)
  const result = await this.listTasksUseCase.execute(query)
  ctx.json(successResponse(result))
}
```

## Differences from Mongoose Edition

| Aspect | Drizzle | Mongoose |
|--------|---------|----------|
| Database | PostgreSQL | MongoDB |
| Schema location | Centralized in `src/db/schema/` | Per-module in `infrastructure/schemas/` |
| Auth approach | Custom JWT middleware | `@forinda/kickjs-auth` adapter |
| Query style | SQL with Drizzle query builder | Mongoose `find()` with query helpers |

## Source

- [examples/jira-drizzle-api/](https://github.com/forinda/kick-js/tree/main/examples/jira-drizzle-api)
