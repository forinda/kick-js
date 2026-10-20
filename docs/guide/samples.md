# Samples

A copy-pasteable tour of the patterns KickJS leans on. Each sample is the **recommended** way to do the thing — short enough to read in one screen, with a one-line note on _why_ it's the pattern and a link to the full guide when you want the detail.

If you're new, read [What is KickJS](./what-is-kickjs.md) and [Getting Started](./getting-started.md) first, then skim this page top-to-bottom — it doubles as the mental model.

> **The mental model in one breath:** decorate classes (`@Controller`, `@Service`), let the DI container wire them, group them into modules, and `bootstrap()`. `kick typegen` scans your source and feeds the editor types (routes (params/body/query/response), env, DI tokens, context keys) so the framework stays "just TypeScript" with no codegen you hand-maintain.

---

## 1. Bootstrap + a controller

The smallest useful app: a typed controller and a `bootstrap()`.

```ts
// src/modules/users/user.controller.ts
import { Controller, Get, Post, type Ctx } from '@forinda/kickjs'
import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

@Controller()
export class UserController {
  @Get('/')
  list(_ctx: Ctx<KickRoutes.UserController['list']>) {
    return [{ id: '1', name: 'Alice' }] // sent as 200 JSON
  }

  @Post('/', { body: createUserSchema })
  create(ctx: Ctx<KickRoutes.UserController['create']>) {
    ctx.created({ id: '2', ...ctx.body }) // ctx.body is typed { name; email }
  }
}
```

```ts
// src/modules/users/user.module.ts
import { defineModule } from '@forinda/kickjs'
import { UserController } from './user.controller'

export const UserModule = defineModule({
  name: 'UserModule',
  build: () => ({
    routes: () => ({ path: '/users', controller: UserController }),
  }),
})
```

```ts
// src/modules/index.ts
import { defineModules } from '@forinda/kickjs'
import { UserModule } from './users/user.module'

export const modules = defineModules().mount(UserModule())
```

```ts
// src/index.ts
import 'reflect-metadata'
import './config'
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'

export const app = await bootstrap({ modules })
```

**Best pattern:** return the payload for a plain 200 and reach for `ctx.created()` / `ctx.noContent()` when the status matters. Type each handler with `Ctx<KickRoutes.X['method']>`: `kick typegen` infers `params` / `body` / `query` from the route decorator, and the response type from what you return, which is what the [typed client](./tutorial-typed-client.md) reads. → [Controllers](./controllers.md), [Type Generation](./typegen.md)

---

## 2. Dependency injection

Decorate a class with `@Service()` and inject it — by property (`@Autowired`) or by token (`@Inject`).

```ts
import { createToken, Inject, Service, Autowired } from '@forinda/kickjs'

interface IOrderRepository {
  findById(id: string): Promise<Order | null>
}

// Token = the seam for an interface. Reference-equal, type-safe, collision-proof.
export const ORDER_REPO = createToken<IOrderRepository>('OrderRepository')

@Service()
class OrderService {
  // Constructor injection by token (explicit binding):
  constructor(@Inject(ORDER_REPO) private repo: IOrderRepository) {}
}

@Controller()
class OrderController {
  // Property injection by type (lazy — resolved on first access):
  @Autowired() private readonly orders!: OrderService
}
```

**Best pattern:** bind interfaces through `createToken<T>('Name')` (not string literals); use `@Autowired()` for concrete classes and `@Inject(TOKEN)` when you need a specific binding. → [Dependency Injection](./dependency-injection.md)

---

## 3. Modules

Group controllers + their DI bindings into a `defineModule()`.

```ts
import { defineModule } from '@forinda/kickjs'

export const TodosModule = defineModule({
  name: 'TodosModule',
  build: () => ({
    register(container) {
      container.registerFactory(TODOS_REPOSITORY, () => container.resolve(InMemoryTodosRepository))
    },
    routes() {
      return { path: '/todos', controller: TodosController }
    },
  }),
})
```

Mount it with `defineModules().mount(TodosModule())` in `src/modules/index.ts`; `kick g module todos` writes both files and adds the `.mount()` line.

**Best pattern:** prefer the `defineModule()` factory form with a stable `name`; do per-module DI binding in `register(container)` (skip it when `@Service()` / `@Repository()` already register the class) and mount controllers from `routes()`. → [Modules](./modules.md)

---

## 4. Configuration & env

Validate `process.env` once, read it type-safely everywhere.

```ts
// src/config/index.ts — define + validate the schema
import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

const envSchema = fromZod(
  z.object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.url(),
    JWT_SECRET: z.string().min(32),
  }),
)

loadEnvFromSchema(envSchema) // side effect: registers the schema
export default envSchema
```

`src/index.ts` imports `./config` before `bootstrap()` (section 1). Read values in a DI-managed class through `ConfigService`:

```ts
import { Autowired, ConfigService, Service } from '@forinda/kickjs'

@Service()
class TokenService {
  @Autowired() private readonly config!: ConfigService

  sign(userId: string) {
    const secret = this.config.get('JWT_SECRET') // string, typed from the schema
  }
}
```

A concern with several settings of its own gets a section under one prefix, injected only where it's used:

```ts
// src/modules/mail/mail.settings.ts
import { defineSettings, Inject, Service, type SettingsOf } from '@forinda/kickjs'
import { z } from 'zod'

export const MailSettings = defineSettings(
  'MAIL',
  z.object({ host: z.string(), port: z.coerce.number().default(587) }), // MAIL_HOST, MAIL_PORT
)

@Service()
export class Mailer {
  constructor(@Inject(MailSettings) private readonly mail: SettingsOf<typeof MailSettings>) {}
}
```

**Best pattern:** keep the schema in `src/config/index.ts` and import it as a side effect from `src/index.ts` _before_ `bootstrap()` — otherwise `ConfigService.get()` returns `undefined` for your own keys. Inject `ConfigService` in classes; `getEnv('KEY')` is for plain modules outside DI. → [Configuration](./configuration.md)

---

## 5. Context decorators (typed `ctx` population)

The typed, ordered alternative to `@Middleware()` **when the only job is to compute a value other code reads off `ctx`**.

```ts
import { defineHttpContextDecorator, Controller, Get, type RequestContext } from '@forinda/kickjs'

// 1. Declare the value's type so `ctx.get('locale')` is typed.
declare module '@forinda/kickjs' {
  interface ContextMeta {
    locale: { language: string; region: string | null }
  }
}

// 2. Resolve it. `defineHttpContextDecorator` pre-binds ctx to RequestContext.
const ResolveLocale = defineHttpContextDecorator({
  key: 'locale',
  resolve: (ctx) => {
    const header = (ctx.req.headers['accept-language'] as string | undefined) ?? 'en'
    const [language, region] = header.split(',')[0].trim().split('-')
    return { language, region: region ?? null }
  },
})

@Controller()
class HomeController {
  @ResolveLocale
  @Get('/')
  home(ctx: RequestContext) {
    return ctx.json(ctx.get('locale')) // typed
  }
}
```

Parameterised contributors use the curried `.withParams<T>()` form (apply as `@LoadTenant({ source: 'subdomain' })`):

```ts
type LoadTenantParams = { source: 'header' | 'subdomain' }

export const LoadTenant = defineHttpContextDecorator.withParams<LoadTenantParams>()({
  key: 'tenant',
  deps: { registry: TENANT_REGISTRY }, // typed DI, resolved before resolve()
  dependsOn: ['locale'], // topo-sorted at startup; missing/cyclic deps fail boot
  paramDefaults: { source: 'header' },
  resolve: (ctx, { registry }, params) => registry.findFor(ctx, params.source),
})
```

**Best pattern:** declare the `ContextMeta` type first; reach for `dependsOn` to order contributors (it's typo-checked); scaffold one with `kick g contributor <name> --type http|bare [--params …]`. Keep `@Middleware()` for short-circuiting responses or mutating the stream. → [Context Decorators](./context-decorators.md)

---

## 6. Error handling

Throw structured errors; the framework renders them.

```ts
import { HttpException } from '@forinda/kickjs'

throw new HttpException(400, 'Invalid input')
throw HttpException.notFound('User not found')
throw HttpException.fromZodError(result.error) // 422 + field errors
```

For RFC 9457 Problem Details, use `ctx.problem.*` in handlers and `Problems.*` in services (no `ctx` in scope):

```ts
// in a handler
if (!project) {
  return ctx.problem.notFound({ detail: `Project ${ctx.params.id} not found` })
}

// in a service
import { Problems } from '@forinda/kickjs'
if (account.balance < amount) {
  throw Problems.forbidden({ detail: `Balance ${account.balance} < ${amount}` })
}
```

**Best pattern:** `HttpException` for quick errors, `ctx.problem.*` / `Problems.*` when you want machine-readable Problem Details. → [Error Handling](./error-handling.md)

---

## 7. Database (kick/db)

Declare tables in TypeScript, generate reviewed SQL migrations, query with types inferred from the schema.

```ts
// src/db/schema.ts
import { table, uuid, varchar, timestamp } from '@forinda/kickjs-db'

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  name: varchar(120),
  createdAt: timestamp().notNull().defaultNow(),
})
```

```ts
// src/db/client.ts
import '../config' // DB_FILE is in the env schema; `kick db` loads this file without src/index.ts
import Database from 'better-sqlite3'
import { createToken, getEnv } from '@forinda/kickjs'
import { createDbClient } from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'
import * as schema from './schema'

export const db = createDbClient({
  schema,
  dialect: sqliteDialect({ database: new Database(getEnv('DB_FILE')) }),
})
export const APP_DB = createToken<typeof db>('app/Db') // register it in a module's register()
```

```ts
@Service()
export class UsersService {
  @Inject(APP_DB) private db!: typeof db

  findByEmail(email: string) {
    return this.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
  }
}
```

```bash
kick db generate init    # diff the schema into up.sql / down.sql — read them
kick db migrate latest   # apply
```

**Best pattern:** keep the client under your own token typed `typeof db`, so `@Inject` hands back the exact schema; review every generated migration before applying it. → [Database](./database/index.md), [Relations](./database/relations.md), [Queries](./database/queries.md)

---

## 8. Adapters (cross-cutting lifecycle)

Bolt framework-wide behaviour (auth, tracing, multi-tenancy) onto the app via lifecycle hooks.

```ts
import { defineAdapter, type AdapterContext, type AdapterMiddleware } from '@forinda/kickjs'

export const RequestLogger = defineAdapter({
  name: 'RequestLoggerAdapter',
  build: () => ({
    dependsOn: ['OtelAdapter'], // topo-sorted; typo-checked against the plugin registry
    middleware(): AdapterMiddleware[] {
      return [/* express middleware */]
    },
    beforeStart({ container }: AdapterContext) {
      /* warm caches, open pools */
    },
    async shutdown() {
      /* drain, close */
    },
  }),
})

// bootstrap({ adapters: [RequestLogger()] })
```

**Best pattern:** use `defineAdapter()` for app-wide concerns and `dependsOn: ['OtherAdapter']` for ordering; mount as `Adapter(config?)` in `bootstrap({ adapters })`. → [Adapters](./adapters.md)

---

## 9. Scaffolding with `kick g`

Let the CLI write the boilerplate to the right place, in your project's pattern (REST / minimal).

```bash
kick g module user                              # full module (controller, DTOs, service, repo)
kick g scaffold Post title:string published:boolean:optional  # CRUD module from fields
kick g controller auth                          # standalone controller
kick g service payment                          # @Service singleton
kick g contributor tenant --type http           # context contributor (RequestContext)
kick g contributor session --type bare --params "source:string"  # withParams<T>() form
kick g --list                                   # every built-in + plugin generator
```

**Best pattern:** scaffold rather than hand-write — generators emit the typed `Ctx<>` pattern, the right folder layout, and (for contributors) the `ContextMeta` stub, then `kick typegen` wires the editor types. → [Code Generators](./generators.md)

---

## 10. Extending the CLI

Add your own `kick` commands and `kick g` generators from `kick.config.ts`:

```ts
// kick.config.ts
import { defineConfig, defineCliPlugin, defineGenerator } from '@forinda/kickjs-cli'

const actionGen = defineGenerator({
  name: 'action', // `kick g action CreateOrder`
  description: 'Service action',
  files: (ctx) => [
    {
      path: `${ctx.modulesDir}/${ctx.kebab}/${ctx.kebab}.action.ts`,
      content: `export class ${ctx.pascal}Action {}\n`,
    },
  ],
})

export default defineConfig({
  plugins: [
    defineCliPlugin({
      name: 'my-team',
      commands: [
        {
          name: 'db:reset',
          description: 'Reset the dev database',
          steps: ['kick db migrate rollback --all', 'kick db migrate latest'],
        },
      ],
      generators: [actionGen],
    }),
  ],
})
```

**Best pattern:** start with `commands[]` for shell steps; use `register(program, ctx)` when you need flags or subcommands; ship `generators[]` to standardise scaffolds across a team. → [CLI Plugins](./cli-plugins.md), [Custom Commands](./custom-commands.md), [Plugin Generators](./plugin-generators.md)

---

## The "bring-your-own" philosophy

KickJS ships **primitives** (`defineContextDecorator`, `defineAdapter`, `definePlugin`, DI, typegen) rather than opinionated domain packages — so you compose the auth / multi-tenancy / observability layer you actually need instead of fighting one that almost fits. The [BYO Recipes](./byo-recipes.md) guide walks a complete auth layer built entirely from these primitives.

## Where to go next

- **Build a whole app:** the [Taskboard tutorial](./taskboard/1-first-module.md), or browse the runnable [example apps](../examples/index.md).
- **Step-by-step tutorials:** [REST module architecture](./tutorial-ddd-architecture.md), [JWT auth](./tutorial-jwt-auth.md), [query + pagination](./tutorial-query-pagination.md), [realtime](./tutorial-realtime.md), [typed client](./tutorial-typed-client.md), [custom CLI](./tutorial-custom-cli.md).
- **Reference:** [Decorators](./decorators.md), [Type Generation](./typegen.md), [Project Structure](./project-structure.md).
- **Gotchas worth reading early:** [DI gotchas](./tutorial-di-gotchas.md), [HMR + decorators](./tutorial-hmr-decorators.md).
