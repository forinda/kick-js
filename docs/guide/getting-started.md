# Getting Started

## Prerequisites

- Node.js 20+
- pnpm (recommended) or npm

## Create a New Project

```bash
npx @forinda/kickjs-cli new my-api
cd my-api
pnpm install
```

This scaffolds a project with:
- `src/index.ts` — bootstrap entry with Vite HMR
- `src/modules/` — feature modules directory
- `vite.config.ts` — Vite config for HMR dev server
- `kick.config.ts` — CLI configuration (optional)
- `CLAUDE.md` — AI development guide with patterns and conventions
- `AGENTS.md` — AI agent guide with checklists and file locations
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

This generates a full DDD module structure:

```
src/modules/users/
  presentation/
    users.controller.ts
  domain/
    entities/users.entity.ts
    value-objects/users-id.vo.ts
    repositories/users.repository.ts
    services/users-domain.service.ts
  application/
    use-cases/
      create-users.use-case.ts
      list-users.use-case.ts
      get-users.use-case.ts
      update-users.use-case.ts
      delete-users.use-case.ts
    dtos/
      create-users.dto.ts
      update-users.dto.ts
  infrastructure/
    repositories/
      in-memory-users.repository.ts
  index.ts
```

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
import { type AppModule, type ModuleRoutes, buildRoutes } from '@forinda/kickjs'
import { UserController } from './user.controller'

export class UserModule implements AppModule {
  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UserController),
      controller: UserController,
    }
  }
}
```

Register it in `src/modules/index.ts`:

```ts
import type { AppModuleClass } from '@forinda/kickjs'
import { UserModule } from './users/user.module'

export const modules: AppModuleClass[] = [UserModule]
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

That's it. Your API is running at `http://localhost:3000/api/v1/users`.

### Route Summary

In dev mode, a compact route summary is logged at startup:

```
[Application] Routes:
  UserController   /api/v1/users   5 routes (2 GET, 1 POST, 1 PUT, 1 DELETE)
  Total: 5 routes
```

This is enabled by default when `NODE_ENV !== 'production'`. Override with `logRoutesTable`:

```ts
export const app = await bootstrap({
  modules,
  logRoutesTable: true,   // always log (even in production)
  // logRoutesTable: false, // never log
})
```

## Add Swagger Docs

```bash
pnpm add @forinda/kickjs-swagger
```

```ts
import { SwaggerAdapter } from '@forinda/kickjs-swagger'

export const app = await bootstrap({
  modules,
  adapters: [
    new SwaggerAdapter({
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

- [Dependency Injection](./dependency-injection) — learn about the DI container
- [Controllers & Routes](./controllers) — route decorators and validation
- [Middleware](./middleware) — class and method middleware
- [Examples](../examples/) — see complete example applications
