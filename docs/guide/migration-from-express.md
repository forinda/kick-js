# Migrating from Express to KickJS

KickJS runs on Express 5 by default, so your existing Express knowledge applies directly. This guide shows how to translate common Express patterns into KickJS equivalents.

One thing to know up front, because it explains most of the differences below: the HTTP engine is **pluggable**. The same app runs on Express, Fastify, or h3 depending on `bootstrap({ runtime })`, so anything the framework hands your code is engine-neutral — a `RequestContext`, not Express's `req`/`res`. Global middleware is the deliberate exception: it stays engine-native, so your existing `(req, res, next)` functions keep working.

## Quick Comparison

| Express                      | KickJS                                                                  |
| ---------------------------- | ----------------------------------------------------------------------- |
| `app.get('/users', handler)` | `@Get('/') list(ctx)` on a `@Controller`                                |
| `app.use(middleware)`        | `bootstrap({ middlewares: [...] })` — same `(req, res, next)` signature |
| `router.get('/x', mw, h)`    | `@Middleware((ctx, next) => …)` — ctx, not `req`/`res`                  |
| `req.body`                   | `ctx.body`                                                              |
| `req.params`                 | `ctx.params`                                                            |
| `req.query`                  | `ctx.query` or `ctx.qs()`                                               |
| `res.json(data)`             | `ctx.json(data)`                                                        |
| `res.status(201).json(data)` | `ctx.created(data)`                                                     |
| Manual DI / singletons       | `@Service()` + `@Inject()` / `@Autowired()`                             |
| `express.Router()`           | `@Controller()` + `buildRoutes()`                                       |
| Swagger via swagger-jsdoc    | `@ApiTags()` + `SwaggerAdapter` (automatic)                             |

## Step 1: Install KickJS

In your existing Express project:

<PmCommand add="@forinda/kickjs @forinda/kickjs-swagger reflect-metadata zod" />

<PmCommand add="@forinda/kickjs-cli" dev />

Or let the CLI resolve the package and its peers for you:

<PmCommand exec="kick add swagger" />

## Step 2: Replace app.listen with bootstrap

### Before (Express)

```ts
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'

const app = express()

app.use(cors())
app.use(helmet())
app.use(express.json())

// ... routes ...

app.listen(3000, () => console.log('Server running'))
```

### After (KickJS)

```ts
// src/index.ts
import 'reflect-metadata'
import './config' // registers env schema before bootstrap
import cors from 'cors'
import helmet from 'helmet'
import express from 'express'
import { bootstrap } from '@forinda/kickjs'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { modules } from './modules'

// Export the app so the Vite plugin can pick it up in dev mode.
// In production, bootstrap() auto-starts the HTTP server.
export const app = await bootstrap({
  modules,
  middlewares: [cors(), helmet(), express.json()],
  adapters: [SwaggerAdapter({ info: { title: 'My API', version: '1.0.0' } })],
})
```

You keep your existing middleware — KickJS doesn't replace them.

::: warning Always export the app
The Vite dev plugin reads the `app` export to wire HMR. Skipping the
`export` works in production but breaks `kick dev` — controllers won't
update on file changes.
:::

## Step 3: Convert Routes to Controllers

### Before (Express)

```ts
// routes/users.ts
import { Router } from 'express'
import { UserService } from '../services/user.service'

const router = Router()
const userService = new UserService() // manual instantiation

router.get('/', async (req, res) => {
  const users = await userService.findAll()
  res.json(users)
})

router.get('/:id', async (req, res) => {
  const user = await userService.findById(req.params.id)
  if (!user) return res.status(404).json({ message: 'Not found' })
  res.json(user)
})

router.post('/', async (req, res) => {
  const user = await userService.create(req.body)
  res.status(201).json(user)
})

export default router
```

### After (KickJS)

```ts
// src/modules/users/user.controller.ts
import { Controller, Get, Post, Autowired, type Ctx } from '@forinda/kickjs'
import { UserService } from './user.service'

@Controller()
export class UserController {
  @Autowired() private userService!: UserService

  @Get('/')
  async list(ctx: Ctx<KickRoutes.UserController['list']>) {
    ctx.json(await this.userService.findAll())
  }

  @Get('/:id')
  async getById(ctx: Ctx<KickRoutes.UserController['getById']>) {
    const user = await this.userService.findById(ctx.params.id)
    if (!user) return ctx.notFound()
    ctx.json(user)
  }

  @Post('/')
  async create(ctx: Ctx<KickRoutes.UserController['create']>) {
    const user = await this.userService.create(ctx.body)
    ctx.created(user)
  }
}
```

Key differences:

- No `Router()` — the `@Controller` decorator + route decorators handle it
- No `new UserService()` — DI injects it via `@Autowired()`
- `req`/`res` → `ctx` — unified context with helper methods

## Step 4: Convert Services

### Before (Express)

```ts
// services/user.service.ts
export class UserService {
  private db: Database

  constructor() {
    this.db = new Database() // or import a singleton
  }

  async findAll() {
    return this.db.query('SELECT * FROM users')
  }
}
```

### After (KickJS)

```ts
// modules/users/user.service.ts
import { Service, Inject } from '@forinda/kickjs'
import { DB_CLIENT } from '@forinda/kickjs-db'

@Service()
export class UserService {
  constructor(@Inject(DB_CLIENT) private db: Database) {}

  async findAll() {
    return this.db.query('SELECT * FROM users')
  }
}
```

The `@Service()` decorator registers the class as a singleton in the DI container. Dependencies are injected automatically.

## Step 5: Convert Middleware

### Before (Express)

```ts
// middleware/auth.ts
export function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ message: 'Unauthorized' })
  req.user = verifyToken(token)
  next()
}

// Usage:
router.get('/profile', authMiddleware, (req, res) => { ... })
```

### After (KickJS)

There are two places middleware can go, and they take **different signatures**. Getting this
backwards is the most common migration bug, so it's worth reading the distinction once.

#### Global middleware — keep your Express functions as-is

`bootstrap({ middlewares })` is engine-native. Under the default Express runtime your existing
`(req, res, next)` middleware runs unchanged, third-party packages included:

```ts
import cors from 'cors'
import helmet from 'helmet'
import express from 'express'
import { authMiddleware } from './middleware/auth'

export const app = await bootstrap({
  modules,
  middlewares: [cors(), helmet(), express.json(), authMiddleware],
})
```

Anything `authMiddleware` hangs off `req` is still reachable: `ctx.user` falls back to
`req.user`, and `ctx.req` is the raw request.

::: warning Engine-native means engine-specific
These run before route matching and are handed to the engine directly, so a middleware written
against Express won't port if you later switch `runtime` to Fastify or h3. That's the trade for
being able to reuse what you already have.
:::

#### Per-route middleware — `@Middleware()` takes `(ctx, next)`

`@Middleware()` is engine-neutral, so the framework hands the handler a `RequestContext`, not
`req`/`res`:

```ts
import { Controller, Get, Middleware, HttpException, type RequestContext } from '@forinda/kickjs'

// Declare the key once so `ctx.set('user', …)` and `ctx.user` are typed.
declare module '@forinda/kickjs' {
  interface ContextMeta {
    user: { id: string; email: string }
  }
}

const requireAuth = (ctx: RequestContext, next: () => void) => {
  const token = ctx.headers.authorization?.split(' ')[1]
  if (!token) throw new HttpException(401, 'Unauthorized')
  ctx.set('user', verifyToken(token))
  next()
}

@Controller()
export class ProfileController {
  @Get('/profile')
  @Middleware(requireAuth)
  async getProfile(ctx: RequestContext) {
    ctx.json(ctx.user)
  }
}
```

`ctx.set('key', value)` is how a middleware passes a value down to the handler; `ctx.get('key')`
reads it back, and `ctx.user` is a built-in shortcut for the `'user'` key.

::: danger Don't pass an Express middleware to `@Middleware()`
Handing `(req, res, next)` to `@Middleware()` fails in a confusing way rather than a loud one.
The first argument is a `RequestContext`, so `req.headers.authorization` appears to work — and
then `req.user = …` throws `Cannot set property user of #<RequestContext> which has only a
getter`, surfacing as a 500 on that route only. Convert the function to `(ctx, next)`, or move
it to the global `middlewares` array where the Express signature is what's expected.
:::

#### Or skip middleware entirely

If the middleware's only job is to compute a value the handler reads off the request, a
[context decorator](./context-decorators.md) does it with typed DI and declared ordering:

```ts
const LoadUser = defineHttpContextDecorator({
  key: 'user',
  resolve: (ctx) => verifyToken(ctx.headers.authorization?.split(' ')[1]),
})

@LoadUser
@Get('/profile')
getProfile(ctx: RequestContext) {
  ctx.json(ctx.get('user'))
}
```

Keep `@Middleware()` for the jobs contributors deliberately don't do: short-circuiting a
response, touching the response stream, or running before route matching.

## Step 6: Create a Module

Modules replace the Express Router mounting pattern:

### Before (Express)

```ts
// app.ts
app.use('/api/v1/users', usersRouter)
app.use('/api/v1/products', productsRouter)
```

### After (KickJS)

```ts
// src/modules/users/user.module.ts
import { defineModule } from '@forinda/kickjs'
import { UserController } from './user.controller'

export const UserModule = defineModule({
  name: 'UserModule',
  build: () => ({
    routes() {
      // `router` is optional — omit it and the framework calls
      // `buildRoutes(controller)` for you.
      return { path: '/users', controller: UserController }
    },
  }),
})

// src/modules/index.ts
import { defineModules } from '@forinda/kickjs'
import { UserModule } from './users/user.module'
import { ProductModule } from './products/product.module'

// `defineModule` factories are invoked at the registration site.
export const modules = defineModules().mount(UserModule()).mount(ProductModule())

// src/index.ts — apiPrefix + versioning are automatic
export const app = await bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,
})
// Routes: /api/v1/users, /api/v1/products
```

::: tip Class modules are still supported — but don't call them
A `class UserModule implements AppModule` works too; pass the **class itself**, not a call:
`[UserModule, ProductModule]`. Calling a class without `new` throws
`TypeError: Class constructor cannot be invoked without 'new'`. Only `defineModule()` factories
are invoked at the registration site, which is why the generator emits those.
:::

## What You Get for Free

By migrating to KickJS, you automatically get:

- **Swagger/OpenAPI** — no manual annotations, generated from decorators
- **DevTools dashboard** — `/_debug` with health, metrics, routes, DI state
- **Vite HMR** — instant reload during development
- **DI container** — no more manual wiring or singleton patterns
- **Query parsing** — `ctx.qs()` with filters, sort, pagination, search
- **Paginated responses** — `ctx.paginate()` with standardized meta
- **File uploads** — `@FileUpload` decorator with MIME validation
- **CLI generators** — `kick g module user` scaffolds a complete flat REST module (controller, service, repository, DTOs, tests)

## Incremental Migration

You don't have to convert everything at once:

1. Start with `bootstrap()` and your existing middleware
2. Convert one route file at a time to a `@Controller`
3. Add `@Service()` to existing classes gradually
4. Keep raw Express routers mounted alongside KickJS modules

### Mounting an existing Express Router

A module can hand the framework a finished router instead of a controller. `ModuleRoutes.router`
takes any connect-style handler — an `express.Router()`, a third-party router, a hand-composed
stack — and mounts it at the module's path:

```ts
// src/modules/legacy/legacy.module.ts
import { defineModule } from '@forinda/kickjs'
import { legacyRouter } from '../../routes/legacy' // your existing express.Router()

export const LegacyModule = defineModule({
  name: 'LegacyModule',
  build: () => ({
    routes() {
      return { path: '/legacy', router: legacyRouter }
    },
  }),
})
```

It mounts under the same prefix rules as everything else — `/api/v1/legacy/*` above — so
converted and unconverted routes sit side by side and you migrate one router at a time.
Everything in front of it still runs: global `middlewares` (so `express.json()` parses bodies
for the router too), the framework's error handler (a `throw` inside the router becomes a
normal JSON 500), and the 404 handler for unmatched paths underneath it.

When a legacy URL has to stay exactly where it is, `version: false` drops the `/v{n}` segment
and `prefix: false` drops `apiPrefix`. They're independent — set **both** to mount at `path`
exactly, which is what the built-in health module does:

```ts
return { path: '/legacy', router: legacyRouter, version: false, prefix: false } // → /legacy/*
```

::: warning What a router opts out of
`router` and `controller` take different paths through the framework. When you pass `router`,
KickJS mounts it as an opaque handler and cannot see inside it: those routes don't appear in
the boot-time duplicate-route check (KICK006), in `kick typegen` / the typed client, in the
generated OpenAPI spec, or in the boot route summary and the DevTools route list. That's fine
for code on its way out — just don't expect the framework features that read the route table to
know about them.

**Nothing warns about this.** `controller` is optional, and a route entry only fails
(`KICK005`) when _neither_ `router` nor `controller` is given — so a router-only module boots
silently and the first sign that it's invisible is usually a missing Swagger entry. Adapter
notification (`onRouteMount`) and the route summary both run on the `controller` branch, not the
`router` one.

The duplicate check is the one worth watching during a migration: if a router and a controller
both claim `GET /api/v1/things/:id`, boot succeeds and whichever module mounted first answers
every request. The half you just rewrote can sit there serving nothing, silently — so remove the
old route from the router in the same commit that adds the controller.

You can pass **both**: `router` mounts the traffic, and `controller` is what adapters like
`SwaggerAdapter` introspect. Useful while a controller is being extracted from a router.
:::

::: warning An `express.Router()` only works on the Express engine
The bridge is `useConnect()`, which every runtime implements, so a **plain connect handler**
(one that writes with `res.setHeader` / `res.end`) mounts and runs on Express, Fastify and h3
alike.

An `express.Router()` is not that. Its handlers call Express's response sugar — `res.json()`,
`res.send()`, `res.status()` — which only exists because Express decorated the response object.
Bridged into Fastify or h3, the handler gets the raw Node `ServerResponse` and dies on the first
call:

```
TypeError: res.json is not a function
```

It fails per-request, at 500, not at boot. So a mounted Express router is fine while Express is
your engine — just convert those routes before switching `runtime`.
:::

## Related

- [Getting Started](./getting-started.md) — full setup guide
- [Decorators Reference](./decorators.md) — all available decorators
- [CLI Commands](./cli-commands.md) — `kick new`, `kick g`, `kick add`
- [Custom Decorators](./custom-decorators.md) — extend the framework
