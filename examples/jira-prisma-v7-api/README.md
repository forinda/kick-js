# Task Management App — Prisma 7 Edition

A full-featured project management API built with [KickJS](https://forinda.github.io/kick-js/), **Prisma 7**, and PostgreSQL. Demonstrates the Prisma 7 driver adapter pattern with `@prisma/adapter-pg`.

## What's Different from jira-prisma-api (v6)?

| Aspect | Prisma 6 (jira-prisma-api) | Prisma 7 (this example) |
|--------|---------------------------|------------------------|
| Generator | `prisma-client-js` | `prisma-client` with `output` |
| Client import | `from '@prisma/client'` | `from '@/generated/prisma'` |
| Connection | `new PrismaClient()` | `new PrismaClient({ adapter: new PrismaPg(pool) })` |
| Logging | `$on('query', ...)` | Auto — adapter uses `$extends` |
| `@prisma/client` dep | Required | Not needed (client generated locally) |

## Getting Started

```bash
pnpm install

# Generate Prisma client (also runs on postinstall)
npx prisma generate

# Push schema to database
npx prisma db push

# Start dev server
kick dev
```

## Packages

- `@forinda/kickjs-core`, `@forinda/kickjs-http`, `@forinda/kickjs-config`
- `@forinda/kickjs-prisma` — adapter with Prisma 5/6/7 support
- `@forinda/kickjs-swagger`, `@forinda/kickjs-devtools`
- `@forinda/kickjs-ws`, `@forinda/kickjs-queue`, `@forinda/kickjs-cron`, `@forinda/kickjs-mailer`
- `@prisma/adapter-pg` + `pg` — Prisma 7 driver adapter for PostgreSQL

## Learn More

- [KickJS Documentation](https://forinda.github.io/kick-js/)
- [Prisma 7 Upgrade Guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)
