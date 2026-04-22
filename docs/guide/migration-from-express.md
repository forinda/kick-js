# Migrating from Express to KickJS

KickJS is built on Express 5, so your existing Express knowledge applies directly. This guide shows how to translate common Express patterns into KickJS equivalents.

## Quick Comparison

| Express | KickJS |
|---------|--------|
| `app.get('/users', handler)` | `@Get('/') list(ctx)` on a `@Controller` |
| `app.use(middleware)` | `bootstrap({ middleware: [...] })` |
| `req.body` | `ctx.body` |
| `req.params` | `ctx.params` |
| `req.query` | `ctx.query` or `ctx.qs()` |
| `res.json(data)` | `ctx.json(data)` |
| `res.status(201).json(data)` | `ctx.created(data)` |
| Manual DI / singletons | `@Service()` + `@Inject()` / `@Autowired()` |
| `express.Router()` | `@Controller()` + `buildRoutes()` |
| Swagger via swagger-jsdoc | `@ApiTags()` + `SwaggerAdapter` (automatic) |

## Step 1: Install KickJS

```bash
# In your existing Express project
pnpm add @forinda/kickjs @forinda/kickjs-swagger reflect-metadata zod
pnpm add -D @forinda/kickjs-cli

# Or use the CLI to add packages
kick add swagger
```

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
  middleware: [cors(), helmet(), express.json()],
  adapters: [
    SwaggerAdapter({ info: { title: 'My API', version: '1.0.0' } }),
  ],
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

  async findAll() { return this.db.query('SELECT * FROM users') }
}
```

### After (KickJS)

```ts
// modules/users/user.service.ts
import { Service, Inject } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'

@Service()
export class UserService {
  constructor(@Inject(DRIZZLE_DB) private db: AppDatabase) {}

  async findAll() { return this.db.select().from(users).all() }
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

```ts
// You can still use Express middleware directly:
import { Controller, Get, Middleware, HttpException, type Ctx } from '@forinda/kickjs'

const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) throw new HttpException(401, 'Unauthorized')
  ;(req as any).user = verifyToken(token)
  next()
}

@Controller()
export class ProfileController {
  @Get('/profile')
  @Middleware(requireAuth)
  async getProfile(ctx: Ctx<KickRoutes.ProfileController['getProfile']>) {
    const user = (ctx.req as any).user
    ctx.json(user)
  }
}
```

Or keep your Express middleware as-is and apply it globally:

```ts
export const app = await bootstrap({
  modules,
  middleware: [authMiddleware, express.json()],
})
```

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

// src/modules/index.ts
import type { AppModuleClass } from '@forinda/kickjs'
import { UserModule } from './users/user.module'
import { ProductModule } from './products/product.module'

export const modules: AppModuleClass[] = [UserModule, ProductModule]

// src/index.ts — apiPrefix + versioning are automatic
export const app = await bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,
})
// Routes: /api/v1/users, /api/v1/products
```

## What You Get for Free

By migrating to KickJS, you automatically get:

- **Swagger/OpenAPI** — no manual annotations, generated from decorators
- **DevTools dashboard** — `/_debug` with health, metrics, routes, DI state
- **Vite HMR** — instant reload during development
- **DI container** — no more manual wiring or singleton patterns
- **Query parsing** — `ctx.qs()` with filters, sort, pagination, search
- **Paginated responses** — `ctx.paginate()` with standardized meta
- **File uploads** — `@FileUpload` decorator with MIME validation
- **CLI generators** — `kick g module user` scaffolds 18 DDD files

## Incremental Migration

You don't have to convert everything at once. KickJS runs on Express 5, so you can:

1. Start with `bootstrap()` and your existing middleware
2. Convert one route file at a time to a `@Controller`
3. Add `@Service()` to existing classes gradually
4. Keep raw Express routes alongside KickJS modules

```ts
export const app = await bootstrap({
  modules, // converted modules from src/modules/index.ts
  middleware: [
    cors(),
    express.json(),
    // Mount legacy Express router directly:
    (req, res, next) => {
      if (req.path.startsWith('/legacy')) {
        return legacyRouter(req, res, next)
      }
      next()
    },
  ],
})
```

## Related

- [Getting Started](./getting-started.md) — full setup guide
- [Decorators Reference](./decorators.md) — all available decorators
- [CLI Commands](./cli-commands.md) — `kick new`, `kick g`, `kick add`
- [Custom Decorators](./custom-decorators.md) — extend the framework
