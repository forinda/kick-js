# @forinda/kickjs-http

Express 5 application, router builder, RequestContext, middleware, and query parsing for KickJS.

## Install

```bash
# Using the KickJS CLI (recommended — auto-installs peer dependencies)
kick add http

# Manual install
pnpm add @forinda/kickjs-http @forinda/kickjs-core express reflect-metadata
```

## Features

- `Application` class with full lifecycle (setup, start, shutdown, HMR rebuild)
- `bootstrap()` for zero-boilerplate entry with Vite HMR
- `RequestContext` with typed body/params/query and response helpers
- `buildRoutes()` — builds Express routers from decorated controllers
- Built-in middleware: `requestId`, `validate`, `errorHandler`, `csrf`, `upload`
- ORM-agnostic query parsing: `parseQuery()`, `ctx.qs()`, `QueryBuilderAdapter`
- Graceful shutdown with `Promise.allSettled`

## Quick Example

```typescript
import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { UserModule } from './modules/users'

bootstrap({
  modules: [UserModule],
  apiPrefix: '/api',
  defaultVersion: 1,
})
```

## Sub-path Imports

```typescript
import { Application } from '@forinda/kickjs-http/application'
import { RequestContext } from '@forinda/kickjs-http/context'
import { csrf } from '@forinda/kickjs-http/middleware/csrf'
import { upload } from '@forinda/kickjs-http/middleware/upload'
import { parseQuery } from '@forinda/kickjs-http/query'
```

## Documentation

[Full documentation](https://github.com/forinda/kick-js)

## License

MIT
