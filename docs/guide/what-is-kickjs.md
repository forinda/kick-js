# What is KickJS?

KickJS is a production-grade, decorator-driven Node.js framework built on Express 5 and TypeScript. It provides the developer experience of NestJS without the heavy dependencies.

## Why KickJS?

| | KickJS | NestJS | Express |
|---|--------|--------|---------|
| DI container | Built-in (lightweight) | Built-in (heavy) | None |
| TypeScript decorators | Full | Full | None |
| DDD code generators | First-class | Partial | None |
| Zod validation | Native | Via pipes | None |
| OpenAPI from decorators | Automatic | Automatic | None |
| Vite HMR (backend) | Native | None | None |
| Bundle size | Minimal | Heavy | Minimal |

## Design Principles

**Lightweight** — No RxJS, no class-transformer, no class-validator. Just TypeScript, Zod, and decorators.

**Pluggable** — Everything is an adapter or interface. Swap Zod for Yup, Drizzle for Prisma, Redis for in-memory. No vendor lock-in.

**DDD-first** — Code generators produce proper domain-driven structure, not flat CRUD files.

**Vite-native** — The only backend framework with built-in Vite hot reload that preserves connections.

**Extensible CLI** — `kick.config.ts` lets teams define project-specific commands (`db:migrate`, `proto:gen`, `seed`).

## Architecture

```
@forinda/kickjs-testing --> @forinda/kickjs-http --> @forinda/kickjs-core
                                         ^
@forinda/kickjs-config --------------------------+
@forinda/kickjs-swagger --> @forinda/kickjs-core

@forinda/kickjs-cli (standalone)
```

- **@forinda/kickjs** — Unified framework: DI container, 20+ decorators, Express 5, middleware, routing, logger
- **@forinda/kickjs-config** — Zod-based env validation, ConfigService
- **@forinda/kickjs-swagger** — OpenAPI spec generation, Swagger UI, ReDoc
- **@forinda/kickjs-cli** — Project scaffolding, DDD code generators, custom commands
- **@forinda/kickjs-testing** — Test utilities for integration testing
