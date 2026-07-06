# What is KickJS?

KickJS is a production-grade, decorator-driven Node.js framework for TypeScript. It provides the developer experience of NestJS without the heavy dependencies — and the HTTP engine is **pluggable**: the same controllers, modules, and context decorators run on **Express** (the zero-config default), **Fastify**, or **h3** — and as a web-standard `fetch` handler on **Cloudflare Workers, Bun, and Deno**. Swap the engine in one line at bootstrap; see [HTTP Runtimes](./http-runtimes.md) and [Edge Deployment](./edge-deployment.md).

## Why KickJS?

|                         | KickJS                 | NestJS           | Express |
| ----------------------- | ---------------------- | ---------------- | ------- |
| DI container            | Built-in (lightweight) | Built-in (heavy) | None    |
| TypeScript decorators   | Full                   | Full             | None    |
| DDD code generators     | First-class            | Partial          | None    |
| Zod validation          | Native                 | Via pipes        | None    |
| OpenAPI from decorators | Automatic              | Automatic        | None    |
| Vite HMR (backend)      | Native                 | None             | None    |
| Bundle size             | Minimal                | Heavy            | Minimal |

## Design Principles

**Lightweight** — No RxJS, no class-transformer, no class-validator. Just TypeScript, Zod, and decorators.

**Pluggable** — Everything is an adapter or interface. Swap Zod for Yup, Postgres for SQLite, Redis for in-memory. No vendor lock-in.

**Generator-driven** — Code generators scaffold a clean REST module (controller, service, DTOs, repository interface) so you start from a working, layered structure.

**Vite-native** — The only backend framework with built-in Vite hot reload that preserves connections.

**Extensible CLI** — `kick.config.ts` lets teams define project-specific commands (`db:migrate`, `proto:gen`, `seed`).

## Architecture

```
@forinda/kickjs (unified: core + http + config)
       ↓ (peer dependency)
┌──────┼──────────┬───────────┬──────────┐
db  swagger  ws  devtools  ...
                                    (adapter packages)

@forinda/kickjs-cli (standalone)
@forinda/kickjs-vite (dev tooling)
```

- **@forinda/kickjs** — Unified framework: DI container, 20+ decorators, pluggable HTTP runtimes (Express / Fastify / h3), middleware, routing, logger, Zod env config
- **@forinda/kickjs-swagger** — OpenAPI spec generation, Swagger UI, ReDoc
- **@forinda/kickjs-db** — Code-first ORM (Kysely-based): schema, reversible migrations, typed queries — Postgres / MySQL / SQLite
- **@forinda/kickjs-ws** — WebSocket with @WsController, rooms, heartbeat
- **@forinda/kickjs-devtools** — Debug dashboard at /\_debug
- **@forinda/kickjs-ai** — AI/LLM integration adapter
- **@forinda/kickjs-mcp** — Model Context Protocol adapter
- **@forinda/kickjs-cli** — Project scaffolding, DDD code generators, custom commands
- **@forinda/kickjs-vite** — Vite HMR plugin, envWatchPlugin, dev tooling
- **@forinda/kickjs-testing** — Test utilities for integration testing
- **@forinda/kickjs-client** — Typed fetch client for the frontend: response types inferred from your handlers, end to end ([guide](./typed-client.md))
