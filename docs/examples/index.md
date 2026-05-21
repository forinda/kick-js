# Examples

Runnable reference apps live in their own repository — **[forinda/kickjs-examples-archive](https://github.com/forinda/kickjs-examples-archive)** — covering Drizzle, Prisma, Mongoose, `@forinda/kickjs-db`, multi-tenant patterns, and a minimal starter. Open the archive's README for the current catalog so it stays one source of truth.

```bash
git clone https://github.com/forinda/kickjs-examples-archive
cd kickjs-examples-archive/<app>
pnpm install
pnpm dev
```

The `task-*` and `multi-tenant-*` apps need a database — each app's README in the archive carries the `.env.example` and migration recipe.

## Starting your own project

The examples are reference patterns, not project starters. To start a real project, scaffold with the CLI:

```bash
npx @forinda/kickjs-cli new my-api
cd my-api && pnpm dev
```

The CLI scaffolds `tsconfig.json`, `vite.config.ts`, `kick.config.ts`, modules, and env wiring for your chosen template (`rest` / `ddd` / `cqrs` / `minimal`) and repo type (`prisma` / `drizzle` / `inmemory` / `custom`).
