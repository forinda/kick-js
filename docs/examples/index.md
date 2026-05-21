# Examples

Realistic, runnable applications that exercise full KickJS patterns end-to-end live in a separate repository — **[forinda/kickjs-examples-archive](https://github.com/forinda/kickjs-examples-archive)**.

They were extracted from this monorepo so they can release on their own cadence and stop weighing on the framework's CI install time. The patterns and code are the same; only the location changed.

## What's in the archive

| App                                                                                                                   | What it shows                                          |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`minimal-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/minimal-api)                             | Simplest possible app — `bootstrap()` + one controller |
| [`task-drizzle-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/task-drizzle-api)                   | Full task management — PostgreSQL + Drizzle            |
| [`task-prisma-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/task-prisma-api)                     | Full task management — PostgreSQL + Prisma 7           |
| [`task-kickdb-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/task-kickdb-api)                     | KickJS-native ORM — PostgreSQL + `@forinda/kickjs-db`  |
| [`task-mongoose-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/task-mongoose-api)                 | Full task management — MongoDB + Mongoose              |
| [`multi-tenant-drizzle-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/multi-tenant-drizzle-api)   | Multi-tenant pattern — PostgreSQL + Drizzle            |
| [`multi-tenant-prisma-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/multi-tenant-prisma-api)     | Multi-tenant pattern — PostgreSQL + Prisma             |
| [`multi-tenant-mongoose-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/multi-tenant-mongoose-api) | Multi-tenant pattern — MongoDB + Mongoose              |
| [`db-spike-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/db-spike-api)                           | `@forinda/kickjs-db` exploration / spike               |

## Running an example

```bash
git clone https://github.com/forinda/kickjs-examples-archive
cd kickjs-examples-archive/minimal-api
pnpm install
pnpm dev
```

The `task-*` and `multi-tenant-*` apps need a database — each has its own `.env.example` and migration recipe in the app's README.

## Starting your own project

The examples are reference patterns, not project starters. To start a real project, scaffold with the CLI:

```bash
npx @forinda/kickjs-cli new my-api
cd my-api && pnpm dev
```

The CLI scaffolds `tsconfig.json`, `vite.config.ts`, `kick.config.ts`, modules, and env wiring for your chosen template (`rest` / `ddd` / `cqrs` / `minimal`) and repo type (`prisma` / `drizzle` / `inmemory` / `custom`).
