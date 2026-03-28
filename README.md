# KickJS

A production-grade, decorator-driven Node.js framework built on Express 5 and TypeScript.

NestJS ergonomics without the complexity — decorators, DI, module system, and code generators, powered by Zod and Vite.

## Install

```bash
pnpm add @forinda/kickjs express reflect-metadata zod
pnpm add -D @forinda/kickjs-cli
```

Or scaffold a new project:

```bash
npx @forinda/kickjs-cli new my-api
cd my-api && pnpm dev
```

## Hello World

```typescript
import 'reflect-metadata'
import { Controller, Get, Service, Autowired, bootstrap, RequestContext } from '@forinda/kickjs'

@Service()
class GreetService {
  greet(name: string) { return `Hello ${name}` }
}

@Controller()
class HelloController {
  @Autowired() private greet!: GreetService

  @Get('/')
  handle(ctx: RequestContext) {
    ctx.json({ message: this.greet.greet('KickJS') })
  }
}

bootstrap({ modules: [/* your modules */] })
```

## Highlights

- **Custom DI container** — constructor and property injection, no external dependency
- **Decorator-driven** — `@Controller`, `@Get`, `@Post`, `@Service`, `@Autowired`, `@Middleware`
- **Zod-native validation** — schemas double as OpenAPI documentation
- **Vite HMR** — zero-downtime hot reload, preserves DB/Redis/Socket connections
- **DDD generators** — `kick g module users` scaffolds 18 files in 2 seconds
- **Auto OpenAPI** — Swagger UI and ReDoc from decorators + Zod schemas
- **Built-in middleware** — helmet, CORS, CSRF, rate limiting, file uploads, request logging
- **Typed adapters** — `AdapterContext` with `Express`, `http.Server`, `env`, `isProduction`
- **Pluggable** — adapters for database, auth, cache, swagger, queues, WebSocket, cron
- **Extensible CLI** — custom commands in `kick.config.ts`

## Ecosystem

| Package | Description |
|---------|-------------|
| [`@forinda/kickjs`](packages/kickjs/) | Core framework — DI, decorators, Express 5, middleware, routing |
| [`@forinda/kickjs-config`](packages/config/) | Zod-based env validation, ConfigService, `@Value` |
| [`@forinda/kickjs-swagger`](packages/swagger/) | Auto OpenAPI from decorators + Zod |
| [`@forinda/kickjs-cli`](packages/cli/) | Scaffolding, DDD generators, custom commands |
| [`@forinda/kickjs-testing`](packages/testing/) | `createTestApp`, `createTestModule` |
| [`@forinda/kickjs-prisma`](packages/prisma/) | Prisma adapter (v5/6/7) |
| [`@forinda/kickjs-drizzle`](packages/drizzle/) | Drizzle adapter, query builder |
| [`@forinda/kickjs-auth`](packages/auth/) | JWT, API key, OAuth strategies |
| [`@forinda/kickjs-ws`](packages/ws/) | WebSocket with `@WsController` |
| [`@forinda/kickjs-queue`](packages/queue/) | BullMQ, RabbitMQ, Kafka |
| [`@forinda/kickjs-cron`](packages/cron/) | `@Cron` decorator scheduling |
| [`@forinda/kickjs-mailer`](packages/mailer/) | SMTP, Resend, SES |
| [`@forinda/kickjs-graphql`](packages/graphql/) | `@Resolver`, `@Query`, `@Mutation` |
| [`@forinda/kickjs-otel`](packages/otel/) | OpenTelemetry tracing + metrics |
| [`@forinda/kickjs-devtools`](packages/devtools/) | Debug dashboard at `/_debug` |
| [`@forinda/kickjs-notifications`](packages/notifications/) | Email, Slack, Discord, webhook |
| [`@forinda/kickjs-multi-tenant`](packages/multi-tenant/) | Tenant resolution middleware |

## Example Apps

| Example | Stack |
|---------|-------|
| [jira-drizzle-api](examples/jira-drizzle-api/) | PostgreSQL + Drizzle, 14 DDD modules, 144 tests |
| [jira-prisma-api](examples/jira-prisma-api/) | PostgreSQL + Prisma, 134 tests |
| [jira-mongoose-api](examples/jira-mongoose-api/) | MongoDB + Mongoose, 53 tests |
| [minimal-api](examples/minimal-api/) | Simplest possible app |
| [devtools-api](examples/devtools-api/) | DevTools dashboard + reactive state |
| [graphql-api](examples/graphql-api/) | GraphQL with resolvers |

## CLI

```bash
kick new my-api              # Scaffold project
kick dev                     # Vite HMR dev server (~200ms reload)
kick build                   # Production build
kick start                   # Run production
kick g module users          # Generate DDD module (18 files)
kick g module users --repo prisma   # With Prisma repository
kick g module users --repo drizzle  # With Drizzle repository
```

## Technical Decisions

| Area | Choice | Why |
|------|--------|-----|
| Runtime | Node.js 20+ | LTS with native ESM |
| HTTP | Express 5 | Mature, async middleware, wide ecosystem |
| Validation | Zod | Runtime + static types, doubles as OpenAPI schema |
| Build | Vite 8 | Unified toolchain — library builds, HMR, SSR |
| Test | Vitest 4 | ESM-native, fast, Vite-compatible |
| Logging | Pino | Fastest Node.js logger, structured JSON |
| Monorepo | pnpm + Turborepo | Efficient deps, build caching |

## Documentation

**[forinda.github.io/kick-js](https://forinda.github.io/kick-js/)**

## Contributing

```bash
git clone https://github.com/forinda/kick-js.git
cd kick-js
pnpm install && pnpm build && pnpm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## License

MIT — see [LICENSE](LICENSE)
