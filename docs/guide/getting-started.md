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

```typescript
import { Controller, Get, Post } from '@forinda/kickjs'
import { RequestContext } from '@forinda/kickjs'
import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

@Controller()
export class UserController {
  @Get('/')
  async list(ctx: RequestContext) {
    ctx.json([{ id: '1', name: 'Alice' }])
  }

  @Post('/', { body: createUserSchema })
  async create(ctx: RequestContext) {
    // ctx.body is validated and typed
    ctx.created({ id: '2', ...ctx.body })
  }
}
```

## Your First Module

```typescript
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { UserController } from './presentation/user.controller'

export class UserModule implements AppModule {
  register(container: Container): void {
    // Bind interfaces to implementations
  }

  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UserController),
      controller: UserController,
    }
  }
}
```

## Bootstrap

```typescript
import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs'
import { UserModule } from './modules/users'

bootstrap({
  modules: [UserModule],
})
```

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
bootstrap({
  modules: [UserModule],
  logRoutesTable: true,   // always log (even in production)
  // logRoutesTable: false, // never log
})
```

## Add Swagger Docs

```bash
pnpm add @forinda/kickjs-swagger
```

```typescript
import { SwaggerAdapter } from '@forinda/kickjs-swagger'

bootstrap({
  modules: [UserModule],
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
