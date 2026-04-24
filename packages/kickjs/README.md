# @forinda/kickjs

Decorator-driven Node.js framework on Express 5 + TypeScript. Custom DI, module system, code generators, Zod-native validation, Vite HMR.

## Install

```bash
# Scaffold a new project (recommended)
npx @forinda/kickjs-cli new my-api && cd my-api && pnpm dev

# Or add to an existing project
pnpm add @forinda/kickjs express reflect-metadata zod
pnpm add -D @forinda/kickjs-cli
```

## Quick Example

```ts
// src/modules/hello/hello.controller.ts
import { Controller, Get, type RequestContext } from '@forinda/kickjs'

@Controller()
export class HelloController {
  @Get('/')
  hello(ctx: RequestContext) {
    ctx.json({ message: 'Hello from KickJS' })
  }
}
```

```ts
// src/modules/hello/hello.module.ts
import { buildRoutes, type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { HelloController } from './hello.controller'

export class HelloModule implements AppModule {
  routes(): ModuleRoutes {
    // Mount prefix lives here — single source of truth for where routes mount.
    return { path: '/hello', router: buildRoutes(HelloController), controller: HelloController }
  }
}
```

```ts
// src/index.ts
import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'

export const app = await bootstrap({ modules })
```

## Documentation

[forinda.github.io/kick-js](https://forinda.github.io/kick-js/) — full guide, API reference, tutorials, and example apps.

## License

MIT
