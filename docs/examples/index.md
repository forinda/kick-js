# Examples

Runnable reference apps live in their own repository, **[forinda/kickjs-examples-archive](https://github.com/forinda/kickjs-examples-archive)**. Each one installs from npm, matches what `kick new` scaffolds today, passes typecheck, build and tests, and ships a Dockerfile and a "Deploy" section in its README.

```bash
git clone https://github.com/forinda/kickjs-examples-archive
cd kickjs-examples-archive/<app>
pnpm install
pnpm dev
```

Apps that need a database or Redis include a `docker-compose.yml` that starts them, and list the variables they need in `.env.example`.

## Start here

| App                                                                                         | What it shows                                                                                                                                                                                                                                                    | Guide                                          |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [`minimal-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/minimal-api)   | The smallest app: one module, a controller that returns values, a `createTestApp` test                                                                                                                                                                           | [Getting started](../guide/getting-started.md) |
| [`settings-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/settings-api) | Configuration with `defineSettings`: app-wide, adapter-declared and module-declared sections, one adapter mounted twice with `.scoped()`, `_FILE` secrets, secrets that fail closed outside development, a generated `.env.example`, and the DevTools Config tab | [Configuration](../guide/configuration.md)     |

## Data

| App                                                                                                               | What it shows                                                                                                                                                              | Guide                                      |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`task-kickdb-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/task-kickdb-api)                 | kick/db on Postgres: a 17-table schema with enums and relations, generated and reviewed migrations, relational queries, the pool in an adapter with a readiness check      | [Database](../guide/database/index.md)     |
| [`multi-tenant-kickdb-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/multi-tenant-kickdb-api) | kick/db `'column'` tenancy on SQLite: the tenant resolved per request, no tenant code in repositories, a JWT that lists the user's tenants                                 | [Multi-tenancy](../guide/multi-tenancy.md) |
| [`task-drizzle-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/task-drizzle-api)               | A full task-management API with Drizzle wired through your own adapter: JWT auth, workspace authorization on every route, queues, WebSockets, cron, Swagger in development | [Bring your own](../guide/byo-recipes.md)  |
| [`task-prisma-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/task-prisma-api)                 | The same API on Prisma 7                                                                                                                                                   | [Bring your own](../guide/byo-recipes.md)  |
| [`task-mongoose-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/task-mongoose-api)             | The same API on MongoDB and Mongoose, with route flags (`@Public`) and role checks                                                                                         | [Authorization](../guide/authorization.md) |

## Frontends

| App                                                                                           | What it shows                                                                                                                                                                          | Guide                                       |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [`inertia-app`](https://github.com/forinda/kickjs-examples-archive/tree/main/inertia-app)     | Inertia with React and SSR: controllers return pages, validation errors go back to the form, flash messages as dismissible toasts, shared and deferred props                           | [Inertia](../guide/inertia.md)              |
| [`fullstack-app`](https://github.com/forinda/kickjs-examples-archive/tree/main/fullstack-app) | A server and a React app in one workspace: the typed client from `kick typegen` with no hand-written response types, 422 field errors in the form, the built web app served by the API | [Fullstack](../guide/fullstack-frontend.md) |

## Real time, files and background work

| App                                                                                                 | What it shows                                                                                                                                                                  | Guide                                    |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| [`ws-chat`](https://github.com/forinda/kickjs-examples-archive/tree/main/ws-chat)                   | WebSocket controllers: rooms, a per-room user list, token auth on connect, a heartbeat, the Redis broker across instances, a browser page to try it                            | [WebSockets](../guide/websockets.md)     |
| [`file-storage-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/file-storage-api) | Uploads with size and type limits, download and delete, expiring signed URLs; local disk in development and S3 or MinIO in production                                          | [File storage](../guide/file-storage.md) |
| [`queue-jobs-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/queue-jobs-api)     | BullMQ jobs: `@Job`/`@Process`, dispatch that answers 202 with a job id, retries, delayed, bulk and repeating jobs, progress, a status endpoint, and a separate worker process | [Jobs](../guide/jobs.md)                 |
| [`cron-jobs-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/cron-jobs-api)       | `@Cron` with timezones, a run-on-boot job, overlap protection, jobs switched on and off from env, and the serverless trigger route                                             | [Cron](../guide/cron.md)                 |

## Starting your own project

The examples are reference patterns, not project starters. To start a real project, scaffold with the CLI:

```bash
npx @forinda/kickjs-cli new my-api
cd my-api && pnpm dev
```

The CLI writes `tsconfig.json`, `vite.config.ts`, `kick.config.ts`, a first module and the env wiring for your chosen template (`rest`, `minimal`, `fullstack` or `inertia`).
