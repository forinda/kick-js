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

<PmCommand add="@forinda/kickjs @forinda/kickjs-schema @forinda/kickjs-swagger reflect-metadata zod dotenv" />

`@forinda/kickjs-schema` is what lets one Zod schema serve env validation,
request validation and the OpenAPI spec; `dotenv` is an optional peer that makes
`.env` files work. Both are covered in [Step 3](#step-3-config-and-environment).

<PmCommand add="@forinda/kickjs-cli" dev />

Or let the CLI resolve the package and its peers for you:

<PmCommand exec="kick add swagger" />

### The build setup KickJS expects

Decorators need a compiler that emits metadata, and `kick dev` runs your app
_inside_ Vite. An existing Express project built with `tsc` and `nodemon` needs
four files before `bootstrap()` will run. `kick new` writes them for a fresh
project; migrating means adding them by hand.

**`tsconfig.json`** — decorator metadata is what makes `@Inject()` and
`@Autowired()` resolve types at runtime, and the `include` is what puts the
generated types in scope:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node", "vite/client"],
    "experimentalDecorators": true, // required
    "emitDecoratorMetadata": true, // required
    "strict": true,
    "paths": { "@/*": ["./src/*"] },
  },
  // .kickjs/types is written by `kick typegen`, outside src/
  "include": ["src", ".kickjs/types/**/*.d.ts", ".kickjs/types/**/*.ts"],
}
```

**`vite.config.ts`** — SWC does the decorator transform (esbuild, Vite's
default, does not emit decorator metadata), and `kickjsVitePlugin` reads your
`app` export to drive HMR:

```ts
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import swc from 'unplugin-swc'
import { kickjsVitePlugin, envWatchPlugin } from '@forinda/kickjs-vite'

export default defineConfig({
  oxc: false, // let SWC own the transform
  plugins: [
    swc.vite(),
    kickjsVitePlugin({ entry: 'src/index.ts' }),
    envWatchPlugin(), // full reload when .env changes
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'node20',
    ssr: true,
    outDir: 'dist',
    rollupOptions: {
      input: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      output: { format: 'esm' },
    },
  },
})
```

<PmCommand add="@forinda/kickjs-vite unplugin-swc" dev />

**`kick.config.ts`** — what the generators read (module directory, repository
default, typegen settings). Let the CLI write it:

<PmCommand exec="kick g config" />

**`package.json`** — `"type": "module"`, and the scripts move to the CLI. Use
`kick dev`, not bare `vite`: `kick dev` boots Vite _and_ owns the
typegen-on-save watcher, so new routes keep their types.

```jsonc
{
  "type": "module",
  "scripts": {
    "dev": "kick dev",
    "build": "kick build",
    "start": "kick start",
    "test": "vitest run",
  },
}
```

Then run `kick typegen` once so `KickRoutes` and `KickEnv` exist before you
reference them (`kick dev` re-runs it on every save):

<PmCommand exec="kick typegen" />

::: tip Check the setup before converting routes
`kick doctor` runs pre-flight checks on an existing project and reports each one
with a fix — including the two decorator flags above, which are the failure
that's hardest to read: without them the app boots and then throws
`No provider for …` on the first injected dependency.
:::

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

## Step 3: Config and Environment

Express projects usually call `dotenv.config()` somewhere near the top and then
read `process.env.WHATEVER` — a string, unvalidated, everywhere. KickJS wants one
schema file instead, and gives you typed access to it from anywhere in the DI
graph.

### Before (Express)

```ts
import dotenv from 'dotenv'
dotenv.config()

const port = Number(process.env.PORT ?? 3000) // coerce by hand, every time
const dbUrl = process.env.DATABASE_URL! // trust me, it's there
```

### After (KickJS)

Declare the shape once in `src/config/index.ts`:

```ts
// src/config/index.ts
import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

const envSchema = fromZod(
  z.object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
  }),
)

// Side effect: registers the schema with the env cache at module-load time.
export const env = loadEnvFromSchema(envSchema)

// Default export: the contract `kick typegen` reads to populate `KickEnv`.
export default envSchema
```

`fromZod` wraps the schema as a `KickSchema`, which is the same shape the
validate middleware and the OpenAPI generator consume — so one schema library
choice covers env, request validation and docs. Valibot and Yup work too
(`fromValibot`, `fromYup` from `@forinda/kickjs-schema/*`); the file is otherwise
identical.

Missing or malformed values fail at startup with a message naming the key,
rather than surfacing as `undefined` three layers into a request.

### Mount it before `bootstrap()`

The schema registers as a **module-load side effect**, so the import has to come
first — this is the line in `src/index.ts` from Step 2:

```ts
import 'reflect-metadata'
import './config' // ← must be above bootstrap()
import { bootstrap } from '@forinda/kickjs'
```

::: danger This is the failure that looks like it works
Skip that import and `ConfigService.get('DATABASE_URL')` returns `undefined` —
it reads the env cache, and nothing registered a schema. Meanwhile
`@Value('DATABASE_URL')` keeps returning a value, because it falls back to raw
`process.env` when no resolver is registered
(`container.ts:902`).

So half your config works, the other half is silently `undefined`, and the half
that "works" hands you the **unparsed string** — `PORT` is `'3000'`, not `3000`,
and every `z.coerce` / `.default()` in your schema is skipped. Import
`./config` and both paths agree.
:::

### Reading config

Two ways, both typed against the schema once `kick typegen` has run:

```ts
import { Service, Autowired, Value, ConfigService } from '@forinda/kickjs'

@Service()
export class DatabaseService {
  // Property injection — good for one or two values
  @Value('DATABASE_URL') private readonly url!: string
  @Value('PORT') private readonly port!: number // already a number

  // Or inject the service — good when you need several
  @Autowired() private readonly config!: ConfigService

  connect() {
    const level = this.config.get('LOG_LEVEL') // typed string
    // this.config.get('NOPE')                 // tsc error after typegen
  }
}
```

Before `kick typegen` runs, both accept any string key (so existing code keeps
compiling). After it runs, `KickEnv` is populated from your default export and
unknown keys become type errors — that's the whole reason the file
`export default`s the schema.

### `.env` files

`dotenv` is loaded for you (it ships as a dependency of a scaffolded app). Keep
your existing `.env`; add `.env.test` when you have a suite, because under a test
run KickJS reads `.env.test` **instead of** `.env` — no layering, no fallback —
so a test can't reach a live service through a var it forgot to override.

See [Configuration](./configuration.md) for the full precedence rules and the
`ConfigService` API.

## Step 4: Convert Routes to Controllers

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

## Step 5: Convert Services

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
import { DB_CLIENT, type KickDbClient } from '@forinda/kickjs-db'

@Service()
export class UserService {
  constructor(@Inject(DB_CLIENT) private db: KickDbClient) {}

  async findAll() {
    return this.db.query('SELECT * FROM users')
  }
}
```

The `@Service()` decorator registers the class as a singleton in the DI container. Dependencies are injected automatically.

## Step 6: Convert Middleware

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

## Step 7: Create a Module

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
