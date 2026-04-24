# Examples

Realistic, runnable applications that exercise full KickJS patterns end-to-end. Each example was scaffolded with the CLI (`kick new` + `kick g module`) and customized.

## Task Management Apps

Production-shaped DDD apps with 14 modules, JWT auth, real-time WebSocket, BullMQ queues, cron jobs, Swagger, and DevTools — same scope across three database stacks so you can compare ORM choices.

| App | Database | ORM |
|---|---|---|
| [task-drizzle-api](./task-drizzle-api) | PostgreSQL | Drizzle |
| [task-prisma-api](./task-prisma-api) | PostgreSQL | Prisma 7 (driver adapters) |
| [task-mongoose-api](./task-mongoose-api) | MongoDB | Mongoose |

## Multi-Tenant Apps

Demonstrate the `@forinda/kickjs-multi-tenant` resolution + per-tenant connection caching pattern.

| App | Database | ORM |
|---|---|---|
| [multi-tenant-drizzle-api](./multi-tenant-drizzle-api) | PostgreSQL | Drizzle |
| [multi-tenant-prisma-api](./multi-tenant-prisma-api) | PostgreSQL | Prisma |
| [multi-tenant-mongoose-api](./multi-tenant-mongoose-api) | MongoDB | Mongoose |

## Starter

The simplest possible app — `bootstrap()` and one route in ~10 lines.

[minimal-api](./minimal-api)

## Running Examples

```bash
git clone https://github.com/forinda/kick-js.git
cd kick-js
pnpm install
pnpm build

# Run any example
cd examples/minimal-api
kick dev
```

## Creating Your Own

```bash
npx @forinda/kickjs-cli new my-api
cd my-api
pnpm install
pnpm kick g module users
pnpm kick dev
```
