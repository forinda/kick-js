# Jira Clone (Mongoose + MongoDB)

A full-featured project management API built with KickJS, MongoDB, and Mongoose. Same scope as the Drizzle edition but demonstrates MongoDB patterns and the `@forinda/kickjs-auth` adapter.

## Features

- **14 DDD modules** — auth, users, workspaces, projects, tasks, labels, comments, attachments, channels, messages, notifications, activity, stats
- **MongoDB + Mongoose** — document schemas with text indexes and TTL cleanup
- **`@forinda/kickjs-auth`** — JWT strategy with `@Public()` decorator and protected-by-default policy
- **Real-time** — WebSocket adapter for live updates
- **Background jobs** — BullMQ queues for email, notifications, activity logging
- **Cron jobs** — token cleanup, overdue reminders, health checks, daily digests, presence cleanup
- **Swagger UI** at `/docs`, **DevTools** at `/_debug`

## Running

```bash
cd examples/jira-mongoose-api

# Set up MongoDB and Redis connection
cp .env.example .env  # edit MONGO_URI and REDIS_URL

# Start dev server
kick dev
```

No migrations needed — Mongoose creates collections automatically.

## Packages Used

| Package | Purpose |
|---------|---------|
| `@forinda/kickjs` | DI, decorators, module system |
| `@forinda/kickjs` | Express 5, routing, middleware |
| `@forinda/kickjs-config` | Zod-based env validation |
| `@forinda/kickjs-swagger` | OpenAPI docs |
| `@forinda/kickjs-devtools` | Debug dashboard |
| `@forinda/kickjs-auth` | JWT auth with `@Public()` decorator |
| `@forinda/kickjs-queue` | BullMQ job processing |
| `@forinda/kickjs-cron` | Scheduled tasks |
| `@forinda/kickjs-mailer` | Email transport (Console or Resend) |
| `@forinda/kickjs-ws` | WebSocket adapter |

## Project Structure

```
src/
  index.ts                    # Bootstrap with all adapters
  config/
    adapters.ts               # Adapter instances
    env.ts                    # Zod env schema
  shared/
    infrastructure/
      database/
        mongoose.adapter.ts   # Custom Mongoose connection adapter
        query-helpers.ts      # Pagination/filter building
      mail/
        resend.provider.ts    # Resend email provider
      redis/
        redis.config.ts       # Redis adapter
    utils/                    # Response helpers, constants
  modules/
    auth/                     # JWT login, register, refresh
    users/                    # User CRUD, profile
    workspaces/               # Workspace management, member roles
    projects/                 # Project CRUD
    tasks/                    # Task CRUD, status changes, reordering, subtasks
    labels/                   # Label CRUD
    comments/                 # Task comments
    attachments/              # File attachments
    channels/                 # Chat channels
    messages/                 # Channel messaging
    notifications/            # In-app notifications
    activity/                 # Activity log
    stats/                    # Dashboard statistics
    queue/                    # BullMQ processors
    cron/                     # Scheduled jobs
```

Each module follows **Domain-Driven Design** layers with per-module schemas:

```
modules/{name}/
  presentation/                # Controllers
  application/                 # Use cases and DTOs (Zod schemas)
  domain/                      # Entities, repository interfaces + DI tokens
  infrastructure/
    schemas/{name}.schema.ts   # Mongoose schema definition
    mongo-{name}.repository.ts # MongoDB repository implementation
```

## Key Patterns

### Authentication with `@forinda/kickjs-auth`

Uses the framework's auth adapter with a protected-by-default policy:

```ts
new AuthAdapter({
  strategy: 'jwt',
  secret: env.JWT_SECRET,
  defaultPolicy: 'protected',
})
```

Public routes opt out with `@Public()`:

```ts
@Controller('/auth')
export class AuthController {
  @Post('/login')
  @Public()
  async login(ctx: RequestContext) { ... }

  @Post('/register')
  @Public()
  async register(ctx: RequestContext) { ... }
}
```

### Mongoose Schemas

Schemas are defined per-module in `infrastructure/schemas/`:

```ts
const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
}, { timestamps: true })

userSchema.index({ email: 'text', name: 'text' })
```

### Pagination Helpers

Shared query helpers build MongoDB filters from parsed query strings:

```ts
// shared/infrastructure/database/query-helpers.ts
const result = await Model.find(filters)
  .sort(sortObj)
  .skip(offset)
  .limit(limit)
```

### Additional Middleware

Unlike the Drizzle edition, this example includes CORS, Helmet, and Morgan:

```ts
bootstrap({
  modules,
  middleware: [
    cors({ origin: env.CORS_ORIGIN }),
    helmet(),
    morgan('dev'),
    requestId(),
    express.json({ limit: '5mb' }),
  ],
})
```

## Differences from Drizzle Edition

| Aspect | Mongoose | Drizzle |
|--------|----------|---------|
| Database | MongoDB | PostgreSQL |
| Schema location | Per-module `infrastructure/schemas/` | Centralized `src/db/schema/` |
| Auth approach | `@forinda/kickjs-auth` + `@Public()` | Custom JWT middleware |
| Migrations | None (auto-created) | Drizzle Kit migrations |
| Query style | `Model.find()` with query helpers | Drizzle SQL query builder |
| Email provider | Resend integration available | Console provider only |

## Source

- [examples/jira-mongoose-api/](https://github.com/forinda/kick-js/tree/main/examples/jira-mongoose-api)
