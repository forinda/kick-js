# Getting Started

> 📖 **Reading this on GitHub?** The full rendered docs live at <https://kickjs.app/> — every `./*.md` link in this page resolves there too.

## Prerequisites

- Node.js 20+ to **run** an app (`@forinda/kickjs` itself)
- Node.js `^22.18.0 || >=24.11.0` to use the **dev server** (`kick dev`) — `@forinda/kickjs-vite` depends on Babel 8, which is ESM-only and sets that floor. Node 20 reached end-of-life in 2026, so upgrading is recommended regardless.
- pnpm (recommended), npm, yarn or bun

## Create a New Project

<PmCommand dlx="@forinda/kickjs-cli new my-api" />

```bash
cd my-api
```

<PmCommand install />

`kick new` detects your package manager from corepack and the lockfile; `--pm pnpm|npm|yarn|bun` overrides it.

This scaffolds a project with the **default layout** — every path below is a convention configurable through `kick.config.ts`, not a framework requirement:

- `src/index.ts` — bootstrap entry with Vite HMR
- `src/modules/` — feature modules directory (configurable via `modules.dir`)
- `vite.config.ts` — Vite config for HMR dev server
- `kick.config.ts` — CLI configuration (optional)
- `AGENTS.md` — canonical multi-agent reference (Claude, Copilot, Codex, Gemini, …) — conventions, patterns, gotchas
- `CLAUDE.md` — thin Claude-specific layer that points at `AGENTS.md`
- `kickjs-skills.md` — task-oriented skill index for AI agents (`add-module`, `bootstrap-export`, `deny-list`, …)

- `README.md` — project documentation

After a framework upgrade, refresh the three agent files with `kick g agents -f` (see [Generators → kick g agents](./generators.md#kick-g-agents)).

## Start Development

<PmCommand run="dev" />

The dev server starts with Vite HMR — edit any file and the server rebuilds instantly without restarting. Database connections, Redis, and WebSocket state are preserved.

Check it came up:

```bash
curl localhost:3000/health/live
# {"status":"ok","uptime":1.42}
```

`/health/live` and `/health/ready` are built in — a liveness probe and a readiness probe that runs every adapter's `onHealthCheck()`. They mount at the root, outside `apiPrefix`, so a probe URL an orchestrator is configured against does not move when your prefix or API version does. Pass `bootstrap({ health: false })` to replace them with your own.

::: tip They run inside your middleware chain
Which means app-wide auth applies to them. If you add global authentication later, exempt `/health` or your liveness probe starts failing.
:::

## Generate a Module

<PmCommand exec="kick g module users" />

This generates a flat REST module under the configured `modules.dir` (default `src/modules`, override via `kick.config.ts`):

```
src/modules/users/
  users.module.ts          # defineModule() factory
  users.controller.ts      # @Controller() — HTTP routes
  users.service.ts         # @Service() — business logic
  users.constants.ts       # query config
  users.repository.ts      # factory + contract + DI token, one file
  dtos/
    create-users.dto.ts
    update-users.dto.ts
    users-response.dto.ts
  __tests__/
    users.controller.test.ts
    users.repository.test.ts
```

`rest` is the default pattern; pass `--pattern minimal` (or `--minimal`) for just a controller + module.

Need a real database? `--repo postgres` names the store in the stub's TODOs — the file and its identifiers are the same either way — or reach for the first-party [`@forinda/kickjs-db`](./database/) layer.

::: tip `--pattern` picks a module shape, `--template` picks a project
`--pattern rest|minimal` is a `kick g module` flag. Whole-project templates are chosen once at scaffold time with `kick new -t rest|minimal|fullstack` — `fullstack` gives you a server plus a typed web app in one workspace (see the [typed client](./typed-client.md)).
:::

## Your First Controller

```ts
import { Controller, Get, Post, reply, type Ctx } from '@forinda/kickjs'
import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

@Controller()
export class UsersController {
  @Get('/')
  async list(_ctx: Ctx<KickRoutes.UsersController['list']>) {
    // Return-value handlers: the runtime sends this as 200 json, and
    // `kick typegen` infers the response type for the typed client.
    return [{ id: '1', name: 'Alice' }]
  }

  @Post('/', { body: createUserSchema, name: 'CreateUser' })
  async create(ctx: Ctx<KickRoutes.UsersController['create']>) {
    // ctx.body is validated and typed from the Zod schema
    return reply(201, { id: '2', ...ctx.body })
  }
}
```

(`ctx.json(...)` / `ctx.created(...)` remain fully supported — returning the
payload is what makes the response type statically inferable. See
[Return-Value Handlers](./controllers.md#return-value-handlers).)

## Your First Module

```ts
import { defineModule } from '@forinda/kickjs'
import { UsersController } from './users.controller'

export const UsersModule = defineModule({
  name: 'UsersModule',
  build: () => ({
    routes() {
      return {
        path: '/users',
        controller: UsersController, // framework derives the router via buildRoutes()
      }
    },
  }),
})
```

Register it in `src/modules/index.ts`:

```ts
import type { AppModuleEntry } from '@forinda/kickjs'
import { UsersModule } from './users/users.module'

// `defineModule` factories are called at the registration site —
// the invocation produces the AppModule instance bootstrap registers.
export const modules: AppModuleEntry[] = [UsersModule()]
```

## Bootstrap

```ts
// src/index.ts
import 'reflect-metadata'
import './config' // registers env schema before bootstrap
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'

// Export the app so the Vite plugin can pick it up in dev mode.
// In production, bootstrap() auto-starts the HTTP server.
export const app = await bootstrap({ modules })
```

::: warning Always export the app
The Vite dev plugin reads the `app` export to wire HMR. Skipping the
`export` works in production but breaks `kick dev` — controllers won't
update on file changes.
:::

`bootstrap()` takes many more options (runtime, middlewares, port, cluster, security…) — the full table is the [bootstrap() options reference](../api/core.md#bootstrap-options). The separate `kick.config.ts` file (CLI/codegen) is documented at [KickConfig](../api/cli.md#kickconfig).

That's it. Your API is running at `http://localhost:3000/api/v1/users`.

### Choosing an HTTP engine

Express is the default, but controllers, modules, DI and `RequestContext` are engine-neutral — swap the engine with one option and nothing else changes:

```ts
import { fastifyRuntime } from '@forinda/kickjs/fastify'

export const app = await bootstrap({ modules, runtime: fastifyRuntime() })
```

`expressRuntime()` (default), `fastifyRuntime()` and `h3Runtime()` all ship in the box; h3 also has web-standard entries for edge, Bun and Deno. See [HTTP Runtimes](./http-runtimes.md).

Point your tests at the same engine you deploy — `createTestApp({ runtime })` — or a green Express suite tells you nothing about the Fastify app you ship.

### Route Summary

Opt in to a compact route table at startup with `logRouteTable: true`:

```ts
export const app = await bootstrap({
  modules,
  logRouteTable: true,
})
```

```
[Application] Routes:
  UsersController  /api/v1/users   5 routes (2 GET, 1 POST, 1 PUT, 1 DELETE)
  Total: 5 routes
```

It is **off by default** (it used to print automatically in dev). When enabled it logs at `info` level, so it appears at the default `LOG_LEVEL` but is hidden if you raise the threshold to `warn`/`error`/`silent`. The old `logRoutesTable` option still works as a deprecated alias.

## Add Swagger Docs

<PmCommand add="@forinda/kickjs-swagger" />

```ts
import { SwaggerAdapter } from '@forinda/kickjs-swagger'

export const app = await bootstrap({
  modules,
  adapters: [
    SwaggerAdapter({
      info: { title: 'My API', version: '1.0.0' },
    }),
  ],
})
```

Visit `http://localhost:3000/docs` for Swagger UI.

## Run the Tests

`kick g module` writes a `__tests__/` folder next to the module. Run them with your test runner — the scaffold ships Vitest:

<PmCommand run="test" />

The generated controller test boots the module through `createTestApp` and asserts against real responses, so it fails if you break a route.

## Production Build

<PmCommand run="build
start" />

## Next Steps

- [Dependency Injection](./dependency-injection.md) — learn about the DI container
- [Controllers & Routes](./controllers.md) — route decorators and validation
- [Middleware](./middleware.md) — class and method middleware
- [Plugins](./plugins.md) — bundle modules, adapters, middleware, and DI bindings into one reusable unit with `definePlugin()` and mount them via `bootstrap({ plugins: [...] })`
- [HTTP Runtimes](./http-runtimes.md) — run the same app on Express, Fastify or h3
- [Testing](./testing.md) — `createTestApp`, DI overrides, and testing the engine you deploy
- [Typed Client](./typed-client.md) — call the API from your frontend with response types inferred from these handlers
- [Examples](../examples/index.md) — see complete example applications
