# Task Management App (Prisma 7)

A full-featured task management API built with KickJS, **Prisma 7**, and PostgreSQL. Demonstrates the Prisma 7 driver adapter pattern with `@prisma/adapter-pg`.

## Features

- **14 DDD modules** — auth, users, workspaces, projects, tasks, labels, comments, attachments, channels, messages, notifications, activity, stats
- **PostgreSQL + Prisma 7** — driver adapter wiring (`PrismaPg` over a `pg.Pool`); generated client lives under `src/generated/prisma/`
- **`@forinda/kickjs-auth`** — JWT strategy with `@Public()` decorator and protected-by-default policy
- **Real-time** — WebSocket adapter for live updates
- **Background jobs** — BullMQ queues for email, notifications, activity logging
- **Cron jobs** — token cleanup, overdue reminders, health checks, daily digests, presence cleanup
- **Swagger UI** at `/docs`, **DevTools** at `/_debug`

## Running

```bash
cd examples/task-prisma-api

# Set up Postgres + Redis connection
cp .env.example .env  # edit DATABASE_URL and REDIS_URL

# Generate Prisma client (also runs on postinstall)
npx prisma generate

# Push schema to database
npx prisma db push

# Start dev server
kick dev
```

## What's Different from Prisma 5/6

| Aspect | Prisma 5/6 | Prisma 7 (this example) |
|--------|------------|--------------------------|
| Generator | `prisma-client-js` | `prisma-client` with `output` |
| Client import | `from '@prisma/client'` | `from '@/generated/prisma'` |
| Connection | `new PrismaClient()` | `new PrismaClient({ adapter: new PrismaPg(pool) })` |
| Logging | `$on('query', ...)` | Auto — adapter uses `$extends` |
| `@prisma/client` dep | Required | Not needed (client generated locally) |

## Packages Used

| Package | Purpose |
|---------|---------|
| `@forinda/kickjs` | Core framework: DI, decorators, Express 5 routing, middleware |
| `@forinda/kickjs-config` | Zod-based env validation |
| `@forinda/kickjs-swagger` | OpenAPI docs |
| `@forinda/kickjs-devtools` | Debug dashboard |
| `@forinda/kickjs-auth` | JWT auth with `@Public()` decorator |
| `@forinda/kickjs-prisma` | Prisma adapter — supports v5 / v6 / v7 client shapes |
| `@forinda/kickjs-queue` | BullMQ job processing |
| BYO cron via `defineAdapter` + `croner` | Scheduled tasks — see [Cron guide](../guide/cron.md) |
| BYO mailer via `definePlugin` + nodemailer/Resend | Email transport — see [Mailer guide](../guide/mailer.md) |
| `@forinda/kickjs-ws` | WebSocket adapter |
| `@prisma/adapter-pg` + `pg` | Prisma 7 driver adapter for PostgreSQL |

## Source

- [examples/task-prisma-api/](https://github.com/forinda/kick-js/tree/main/examples/task-prisma-api)
- [Prisma 7 Upgrade Guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)
