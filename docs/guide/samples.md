# Samples

A copy-pasteable tour of the patterns KickJS leans on. Each sample is the **recommended** way to do the thing — short enough to read in one screen, with a one-line note on _why_ it's the pattern and a link to the full guide when you want the detail.

If you're new, read [What is KickJS](./what-is-kickjs.md) and [Getting Started](./getting-started.md) first, then skim this page top-to-bottom — it doubles as the mental model.

> **The mental model in one breath:** decorate classes (`@Controller`, `@Service`), let the DI container wire them, group them into modules, and `bootstrap()`. `kick typegen` scans your source and feeds the editor types (routes, env, DI tokens, context keys) so the framework stays "just TypeScript" with no codegen you hand-maintain.

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
  async list(ctx: Ctx<KickRoutes.UserController['list']>) {
    ctx.json([{ id: '1', name: 'Alice' }])
  }

  @Post('/', { body: createUserSchema })
  async create(ctx: Ctx<KickRoutes.UserController['create']>) {
    ctx.created({ id: '2', ...ctx.body }) // ctx.body is typed { name; email }
  }
}
```

**Best pattern:** type each handler with `Ctx<KickRoutes.X['method']>` — `kick typegen` infers `params` / `body` / `query` (including the Zod shape on the route decorator) so you never hand-annotate them. → [Controllers](./controllers.md), [Type Generation](./typegen.md)

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

**Best pattern:** prefer the `defineModule()` factory form with a stable `name`; do per-module DI binding in `register(container)` and mount controllers from `routes()`. → [Modules](./modules.md)

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
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
  }),
)

export const env = loadEnvFromSchema(envSchema)
export default envSchema
```

```ts
// src/index.ts — import the schema as a side effect BEFORE bootstrap
import 'reflect-metadata'
import './config'
import { bootstrap } from '@forinda/kickjs'

export const app = await bootstrap({ modules })
```

```ts
// Inject a single value anywhere with @Value (lazy, typed via Env<K>):
import { Service, Value, type Env } from '@forinda/kickjs'

@Service()
class MailService {
  @Value('JWT_SECRET') private readonly secret!: Env<'JWT_SECRET'>
}
```

**Best pattern:** keep the schema in `src/config/index.ts` and import it as a side effect from `src/index.ts` _before_ `bootstrap()` — otherwise `ConfigService.get()` silently falls back to `process.env`. → [Configuration](./configuration.md)

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

## 7. Adapters (cross-cutting lifecycle)

Bolt framework-wide behaviour (auth, tracing, multi-tenancy) onto the app via lifecycle hooks.

```ts
import { defineAdapter, type AdapterContext, type AdapterMiddleware } from '@forinda/kickjs'

export const RequestLogger = defineAdapter({
  name: 'RequestLoggerAdapter',
  build: () => ({
    dependsOn: ['OtelAdapter'], // topo-sorted; typo-checked against the plugin registry
    middleware(): AdapterMiddleware[] {
      return [
        /* express middleware */
      ]
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

## 8. Extending the CLI — the full `defineCliPlugin` surface

The `kick` CLI is itself a composition of plugins — every built-in command ships internally as a `KickCliPlugin`, and adopters extend the **same** surface from `kick.config.ts > plugins[]`. A plugin is an object (or a factory returning one); `defineCliPlugin` is the identity helper for inference.

```ts
import { defineCliPlugin } from '@forinda/kickjs-cli'

export const myPlugin = defineCliPlugin({
  name: 'my-org-cli', // required — stable id, used for de-dup + conflict errors
  commands: [
    /* declarative shell commands */
  ],
  register(program, ctx) {
    /* programmatic Commander commands */
  },
  generators: [
    /* `kick g <name>` scaffolders */
  ],
  // typegens: [ … ]  // ← `kick typegen` plugins — see Type Generation
})

// kick.config.ts
// export default defineConfig({ plugins: [myPlugin] })
```

Everything you can put on a plugin, field by field (typegens aside — those live in [Type Generation](./typegen.md)):

### `name` (required)

A stable identifier. Used to de-dup plugins and to name the offender in conflict errors (two plugins shipping the same command / generator name throw `KickPluginConflictError`). Convention: the package name (`'kickjs-cli-drizzle'`).

### `commands[]` — declarative shell commands

The lowest-ceremony extension: a name, a description, and shell `steps`. Each becomes a `kick <name>` command.

```ts
defineCliPlugin({
  name: 'db-tools',
  commands: [
    {
      name: 'db:migrate', // → `kick db:migrate`
      description: 'Apply pending migrations', // shown in --help
      steps: 'npx drizzle-kit migrate', // string … or string[] for sequential steps
      aliases: ['migrate'], // optional — `kick migrate` also works
    },
    {
      name: 'proto:gen',
      description: 'Codegen protobufs',
      steps: ['npx buf generate', 'echo done'], // runs in order; stops on first failure
    },
  ],
})
```

`steps` may use `{args}` as a placeholder for trailing CLI arguments. Same shape as the top-level `kick.config.ts > commands[]` — a plugin just bundles them for reuse.

### `register(program, ctx)` — programmatic Commander

When declarative `commands` aren't enough (subcommands, options/flags, async actions), get the raw [Commander](https://github.com/tj/commander.js) `program`. Called once at CLI startup.

```ts
defineCliPlugin({
  name: 'reporter',
  register(program, ctx) {
    program
      .command('report <kind>')
      .description('Emit a project report')
      .option('--json', 'machine-readable output')
      .action(async (kind: string, opts: { json?: boolean }) => {
        ctx.log(`project root: ${ctx.projectRoot}`)
        const pattern = ctx.config?.pattern ?? 'rest'
        // … build the report; write to ctx.projectRoot
      })
  },
})
```

The second arg is the **plugin context** (`KickCliPluginContext`) — so the callback never re-loads config or guesses paths:

| Field         | What it is                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `cwd`         | Directory the command was invoked from (may be a nested subdir).                                                                |
| `projectRoot` | Resolved project root (dir owning `kick.config.*`, else nearest `package.json`, else `cwd`). **Prefer this for writing files.** |
| `config`      | The loaded `kick.config.ts` (`KickConfig \| null`).                                                                             |
| `log(msg)`    | Plugin-friendly logger.                                                                                                         |
| `generators?` | Merged plugin generators (built-ins + adopter) — lets a `register()` surface them as real subcommands.                          |

### `generators[]` — custom `kick g <name>` scaffolders

Teach `kick g` your own scaffolds with `defineGenerator`. `kick g <name>` matches `name` (after built-ins), runs `files(ctx)`, and writes each returned `{ path, content }`.

```ts
import { defineCliPlugin, defineGenerator } from '@forinda/kickjs-cli'

const cqrsCommand = defineGenerator({
  name: 'command', // → `kick g command Order`
  description: 'Generate a CQRS command + handler', // shown in `kick g --list`
  args: [{ name: 'name', required: true, description: 'Command name' }], // informational (help)
  flags: [{ name: 'sync', description: 'Synchronous handler', takesValue: false }], // informational
  files: (ctx) => [
    {
      // relative paths resolve against ctx.cwd; parent dirs auto-created
      path: `${ctx.modulesDir}/${ctx.kebab}/commands/create-${ctx.kebab}.command.ts`,
      content: `export class Create${ctx.pascal}Command {}\n`,
    },
  ],
})

export const cqrsPlugin = defineCliPlugin({ name: 'kickjs-cli-cqrs', generators: [cqrsCommand] })
```

The `files(ctx)` factory receives a `GeneratorContext` with the name pre-cased + project paths + raw input:

| Field                                             | Example for `kick g command UserPost extra --sync`                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `name` / `pascal` / `kebab` / `camel` / `snake`   | `UserPost` / `UserPost` / `user-post` / `userPost` / `user_post`                |
| `pluralPascal?` / `pluralKebab?` / `pluralCamel?` | `UserPosts` / `user-posts` / `userPosts` (when `pluralize` is on)               |
| `modulesDir`                                      | `'src/modules'` (from `kick.config.ts`)                                         |
| `cwd` / `projectRoot`                             | invocation dir / resolved project root (prefer `projectRoot` for stable writes) |
| `args`                                            | `['extra']` (positional args after the name)                                    |
| `flags`                                           | `{ sync: true }` (booleans for switches, strings for `--key value`)             |

`files()` may be async and return a `Promise<GeneratorFile[]>`.

**Best pattern:** start with `commands[]` for one-off shell steps; reach for `register()` only when you need options/subcommands/async; ship `generators[]` to standardise scaffolds across a team. Promote a one-project `kick.config.ts > commands[]` to a published `defineCliPlugin` when you want to reuse it. → [CLI Plugins](./cli-plugins.md), [Custom Commands](./custom-commands.md), [Plugin Generators](./plugin-generators.md)

---

## 9. Scaffolding with `kick g`

Let the CLI write the boilerplate to the right place, in your project's pattern (REST / DDD / CQRS).

```bash
kick g module user                              # full module (controller, DTOs, use-cases, repo)
kick g scaffold Post title:string published:boolean:optional  # CRUD module from fields
kick g controller auth                          # standalone controller
kick g service payment                          # @Service singleton
kick g contributor tenant --type http           # context contributor (RequestContext)
kick g contributor session --type bare --params "source:string"  # withParams<T>() form
kick g --list                                   # every built-in + plugin generator
```

**Best pattern:** scaffold rather than hand-write — generators emit the typed `Ctx<>` pattern, the right folder layout, and (for contributors) the `ContextMeta` stub, then `kick typegen` wires the editor types. → [Code Generators](./generators.md)

---

## The "bring-your-own" philosophy

KickJS ships **primitives** (`defineContextDecorator`, `defineAdapter`, `definePlugin`, DI, typegen) rather than opinionated domain packages — so you compose the auth / multi-tenancy / observability layer you actually need instead of fighting one that almost fits. The [BYO Recipes](./byo-recipes.md) guide walks a complete auth layer built entirely from these primitives.

## Where to go next

- **Step-by-step tutorials:** [DDD architecture](./tutorial-ddd-architecture.md), [JWT auth](./tutorial-jwt-auth.md), [query + pagination](./tutorial-query-pagination.md), [realtime](./tutorial-realtime.md), [typed client](./tutorial-typed-client.md), [custom CLI](./tutorial-custom-cli.md).
- **Reference:** [Decorators](./decorators.md), [Type Generation](./typegen.md), [Project Structure](./project-structure.md).
- **Gotchas worth reading early:** [DI gotchas](./tutorial-di-gotchas.md), [HMR + decorators](./tutorial-hmr-decorators.md).
