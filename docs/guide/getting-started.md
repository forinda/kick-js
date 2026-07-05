# Getting Started

> 📖 **Reading this on GitHub?** The full rendered docs live at <https://kickjs.app/> — every `./*.md` link in this page resolves there too.

## Prerequisites

- Node.js 20+
- pnpm (recommended) or npm

## Release channels

KickJS publishes to two npm dist-tags:

- **`@latest`** — the stable channel. This is the default; `npm install @forinda/kickjs` and `npx @forinda/kickjs-cli new` install from here. Use it for production.
- **`@alpha`** — the preview channel for upcoming features and experiments (new HTTP runtimes, in-progress subsystems). Opt in to try things before they stabilize:

  ```bash
  # scaffold with the preview CLI
  npx @forinda/kickjs-cli@alpha new my-api

  # or pin a package to the alpha channel in an existing project
  pnpm add @forinda/kickjs@alpha
  ```

  Alpha builds can change without notice — pin an exact version if you depend on one.

## Create a New Project

```bash
npx @forinda/kickjs-cli new my-api
cd my-api
pnpm install
```

This scaffolds a project with the **default layout** — every path below is a convention configurable through `kick.config.ts`, not a framework requirement:

- `src/index.ts` — bootstrap entry with Vite HMR
- `src/modules/` — feature modules directory (configurable via `modules.dir`)
- `vite.config.ts` — Vite config for HMR dev server
- `kick.config.ts` — CLI configuration (optional)
- `AGENTS.md` — canonical multi-agent reference (Claude, Copilot, Codex, Gemini, …) — conventions, patterns, gotchas
- `CLAUDE.md` — thin Claude-specific layer that points at `AGENTS.md`
- `kickjs-skills.md` — task-oriented skill index for AI agents (`add-module`, `bootstrap-export`, `deny-list`, …)

After a framework upgrade, refresh all three with `kick g agents -f` (see [Generators → kick g agents](./generators.md#kick-g-agents)).

- `README.md` — project documentation

## Start Development

```bash
pnpm kick dev
```

The dev server starts with Vite HMR — edit any file and the server rebuilds instantly without restarting. Database connections, Redis, and WebSocket state are preserved.

## Generate a Module

```bash
pnpm kick g module users
```

This generates a flat REST module under the configured `modules.dir` (default `src/modules`, override via `kick.config.ts`):

```
src/modules/users/
  users.module.ts          # defineModule() factory
  users.controller.ts      # @Controller() — HTTP routes
  users.service.ts         # @Service() — business logic
  users.constants.ts       # query config
  users.repository.ts      # repository interface + DI token
  in-memory-users.repository.ts   # zero-dep impl (the `inmemory` default)
  dtos/
    create-users.dto.ts
    update-users.dto.ts
    users-response.dto.ts
  __tests__/
    users.controller.test.ts
    users.repository.test.ts
```

`rest` is the default pattern; pass `--template minimal` for just a controller + module. Need a real database? Pick a repo by name (`--repo postgres`) for a stub you wire yourself, or reach for the first-party [`@forinda/kickjs-db`](./database/) layer.

## Your First Controller

```ts
import { Controller, Get, Post, type Ctx } from '@forinda/kickjs'
import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

@Controller()
export class UserController {
  @Get('/')
  async list(ctx: Ctx<KickRoutes.UserController['list']>) {
    ctx.json([{ id: '1', name: 'Alice' }])
  }

  @Post('/', { body: createUserSchema, name: 'CreateUser' })
  async create(ctx: Ctx<KickRoutes.UserController['create']>) {
    // ctx.body is validated and typed from the Zod schema
    ctx.created({ id: '2', ...ctx.body })
  }
}
```

## Your First Module

```ts
import { defineModule } from '@forinda/kickjs'
import { UserController } from './user.controller'

export const UserModule = defineModule({
  name: 'UserModule',
  build: () => ({
    routes() {
      return {
        path: '/users',
        controller: UserController, // framework derives the router via buildRoutes()
      }
    },
  }),
})
```

Register it in `src/modules/index.ts`:

```ts
import type { AppModuleEntry } from '@forinda/kickjs'
import { UserModule } from './users/user.module'

// `defineModule` factories are called at the registration site —
// the invocation produces the AppModule instance bootstrap registers.
export const modules: AppModuleEntry[] = [UserModule()]
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
  UserController   /api/v1/users   5 routes (2 GET, 1 POST, 1 PUT, 1 DELETE)
  Total: 5 routes
```

It is **off by default** (it used to print automatically in dev). When enabled it logs at `info` level, so it appears at the default `LOG_LEVEL` but is hidden if you raise the threshold to `warn`/`error`/`silent`. The old `logRoutesTable` option still works as a deprecated alias.

## Add Swagger Docs

```bash
pnpm add @forinda/kickjs-swagger
```

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

## Production Build

```bash
pnpm kick build
pnpm kick start
```

## Next Steps

- [Dependency Injection](./dependency-injection.md) — learn about the DI container
- [Controllers & Routes](./controllers.md) — route decorators and validation
- [Middleware](./middleware.md) — class and method middleware
- [Plugins](./plugins.md) — bundle modules, adapters, middleware, and DI bindings into one reusable unit with `definePlugin()` and mount them via `bootstrap({ plugins: [...] })`
- [Examples](../examples/index.md) — see complete example applications
