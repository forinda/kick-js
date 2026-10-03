# @forinda/kickjs

Decorator-driven Node.js framework for TypeScript: DI, modules, typed request context, validation and generators. It runs on Express (default), Fastify or h3, and on Workers, Bun and Deno through a web-standard entry.

## Install

```bash
npx @forinda/kickjs-cli new my-api && cd my-api && pnpm dev
```

Or add it to an existing project:

```bash
pnpm add @forinda/kickjs express reflect-metadata zod
pnpm add -D @forinda/kickjs-cli @forinda/kickjs-vite
```

## Quick example

```ts
// src/modules/users/user.controller.ts
import { Autowired, Controller, Get, Post, Service, type Ctx } from '@forinda/kickjs'
import { z } from 'zod'

@Service()
export class UserService {
  list() {
    return [{ id: '1', name: 'Alice' }]
  }
}

@Controller()
export class UserController {
  @Autowired() private readonly users!: UserService

  @Get('/')
  list() {
    return this.users.list()
  }

  @Post('/', { body: z.object({ name: z.string().min(1) }) })
  create(ctx: Ctx<KickRoutes.UserController['create']>) {
    ctx.created({ id: '2', name: ctx.body.name })
  }
}
```

```ts
// src/index.ts
import 'reflect-metadata'
import { bootstrap, defineModule, defineModules } from '@forinda/kickjs'
import { UserController } from './modules/users/user.controller'

const UserModule = defineModule({
  name: 'UserModule',
  build: () => ({ routes: () => ({ path: '/users', controller: UserController }) }),
})

export const app = await bootstrap({ modules: defineModules().mount(UserModule()) })
```

`GET /api/v1/users` returns the list. `KickRoutes` comes from `kick typegen`, which `kick dev` runs for you. To use another engine, pass `runtime: fastifyRuntime()` (from `@forinda/kickjs/fastify`) or `h3Runtime()` to `bootstrap()`.

## Documentation

**[kickjs.app](https://kickjs.app/)**. Good places to start:

- [Getting Started](https://kickjs.app/guide/getting-started)
- [Modules](https://kickjs.app/guide/modules), [Controllers](https://kickjs.app/guide/controllers), [Dependency Injection](https://kickjs.app/guide/dependency-injection)
- [HTTP Runtimes](https://kickjs.app/guide/http-runtimes), [Edge Deployment](https://kickjs.app/guide/edge-deployment)
- [Context Decorators](https://kickjs.app/guide/context-decorators), [Adapters](https://kickjs.app/guide/adapters), [Plugins](https://kickjs.app/guide/plugins)
- [BYO Recipes](https://kickjs.app/guide/byo-recipes): auth, GraphQL, OpenTelemetry, cron, mailer, multi-tenancy

## License

MIT
