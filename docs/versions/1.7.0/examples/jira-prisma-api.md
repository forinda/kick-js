# Jira Clone (Prisma + PostgreSQL)

A full-featured project management API built with KickJS, PostgreSQL, and Prisma ORM. Same scope as the Drizzle edition but demonstrates Prisma patterns and the `@forinda/kickjs-prisma` adapter.

## Features

- **14 DDD modules** — auth, users, workspaces, projects, tasks, labels, comments, attachments, channels, messages, notifications, activities, stats
- **PostgreSQL + Prisma** — declarative schema with auto-generated client and migrations
- **JWT auth** — custom auth bridge middleware with refresh token rotation
- **Real-time** — WebSocket adapter for live updates
- **Background jobs** — BullMQ queues for email, notifications, activity logging
- **Cron jobs** — token cleanup, overdue reminders, health checks, daily digests, presence cleanup
- **Swagger UI** at `/docs`, **DevTools** at `/_debug`

## Running

```bash
cd examples/jira-prisma-api

# Set up PostgreSQL and Redis connection
cp .env.example .env  # edit DATABASE_URL and REDIS_URL

# Generate Prisma client and push schema
npx prisma generate
npx prisma db push

# Start dev server
kick dev
```

## Packages Used

| Package | Purpose |
|---------|---------|
| `@forinda/kickjs-core` | DI, decorators, module system |
| `@forinda/kickjs-http` | Express 5, routing, middleware |
| `@forinda/kickjs-config` | Zod-based env validation |
| `@forinda/kickjs-swagger` | OpenAPI docs |
| `@forinda/kickjs-devtools` | Debug dashboard |
| `@forinda/kickjs-prisma` | Prisma adapter, DI integration |
| `@forinda/kickjs-queue` | BullMQ job processing |
| `@forinda/kickjs-cron` | Scheduled tasks |
| `@forinda/kickjs-mailer` | Email transport |
| `@forinda/kickjs-ws` | WebSocket adapter |

## Project Structure

```
prisma/
  schema.prisma               # All 17 models + 5 enums in one file
src/
  index.ts                    # Bootstrap with all adapters
  config/
    adapters.ts               # Adapter instances (Prisma, Swagger, WS, etc.)
    env.ts                    # Zod env schema
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
  presentation/       # Controllers — HTTP handlers
  application/        # Use cases and DTOs (Zod schemas)
  domain/             # Entities, value objects, repository interfaces + DI tokens
  infrastructure/
    repositories/
      prisma-{name}.repository.ts  # Prisma Client implementation
```

## Key Patterns

### Prisma Adapter

Uses `@forinda/kickjs-prisma` to register PrismaClient in the DI container:

```ts
import { PrismaAdapter, PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

bootstrap({
  modules,
  adapters: [
    new PrismaAdapter({ client: prisma, logging: true }),
  ],
})
```

### Repository Pattern

Repositories inject PrismaClient via the `PRISMA_CLIENT` token:

```ts
@Repository()
export class PrismaUserRepository implements IUserRepository {
  @Inject(PRISMA_CLIENT) private prisma!: PrismaClient

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } })
  }

  async findPaginated(parsed: ParsedQuery) {
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        skip: parsed.pagination.offset,
        take: parsed.pagination.limit,
      }),
      this.prisma.user.count(),
    ])
    return { data, total }
  }
}
```

### Prisma Schema

All models are defined in a single `prisma/schema.prisma` file with enums:

```prisma
model User {
  id        String     @id @default(uuid())
  name      String
  email     String     @unique
  password  String
  role      GlobalRole @default(USER)
  createdAt DateTime   @default(now()) @map("created_at")
  updatedAt DateTime   @updatedAt @map("updated_at")

  tasks     Task[]     @relation("reporter")
  comments  Comment[]

  @@map("users")
}
```

## Differences from Drizzle Edition

| Aspect | Prisma | Drizzle |
|--------|--------|---------|
| Schema | Single `schema.prisma` file | Multiple TS files in `src/db/schema/` |
| Client | Auto-generated via `prisma generate` | Manual SQL builder |
| Migrations | `prisma migrate` / `prisma db push` | `drizzle-kit migrate` |
| Query style | `prisma.model.findMany()` | Drizzle SQL query builder |
| Type safety | Generated types from schema | `$inferSelect` / `$inferInsert` |

## Source

- [examples/jira-prisma-api/](https://github.com/forinda/kick-js/tree/main/examples/jira-prisma-api)
