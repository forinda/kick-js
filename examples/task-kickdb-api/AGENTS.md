# AGENTS.md — AI Agent Guide for task-kickdb-api

This guide is the **canonical, multi-agent reference** for this KickJS
application — Claude, Copilot, Codex, Gemini, etc. all read it first.
Per-agent files (`CLAUDE.md`, `GEMINI.md`, etc.) are thin layers that
add tool-specific affordances on top.

## Before You Start

1. Run `pnpm install` to install dependencies
2. Run `kick dev` to verify the app starts
3. Read the [KickJS documentation](https://forinda.github.io/kick-js/) for framework details

## v4 Conventions (don't skip)

KickJS v4 made a handful of structural changes from v3. Internalise these
before generating or modifying code — they are the source of most agent
mistakes:

- **Adapters** — `defineAdapter()` factory. Never write `class Foo implements AppAdapter`.

  ```ts
  export const MyAdapter = defineAdapter<MyOptions>({
    name: 'MyAdapter',
    defaults: { ... },
    build: (config) => ({
      beforeMount({ app }) { /* ... */ },
      afterStart({ server }) { /* ... */ },
    }),
  })
  ```

- **Plugins** — `definePlugin()` factory. Same shape, never plain function returning `KickPlugin`.

- **DI tokens** — slash-delimited `<scope>/<area>/<key>`, lower-case, no `:` separators:

  ```ts
  const USERS_REPO = createToken<UsersRepo>('app/users/repository')
  const DB = createToken<Database>('app/db/connection')
  ```

  The `kick/` prefix is reserved for first-party packages; this project
  owns its own scope (`app/`, your domain name, etc.).

- **`@Controller()`** takes **no path argument**. Mount prefix comes from
  the module's `routes()` return value, not the decorator. `@Controller('/users')`
  is a v3 leftover; the linter and codegen reject it.

- **Env wiring** — `src/config/index.ts` calls `loadEnv(envSchema)` as a
  side effect. `src/index.ts` MUST have `import './config'` as its **first**
  import (before `bootstrap()`). Without it, `ConfigService.get('YOUR_KEY')`
  returns `undefined` and `@Value()` only works via raw `process.env` fallback
  (Zod coercion + defaults silently skipped).

- **Module entry files MUST be named `<name>.module.ts`** — see the Vite
  HMR contract at the top of "Module Pattern" below. The CLI enforces this;
  hand-rolled files must too.

- **Assets** — drop new template files into `src/templates/<namespace>/`
  (or wherever `kick.config.ts` points). The dev watcher auto-rebuilds the
  `KickAssets` augmentation; `assets.x.y()` re-walks on next call. No restart,
  no manual build step.

- **Context over `@Middleware()`** — when a middleware's only job is to
  populate `ctx.set('key', value)`, use `defineHttpContextDecorator()`
  (HTTP) or `defineContextDecorator()` (transport-agnostic) instead.
  Typed via `ContextMeta`, ordered via `dependsOn`, validated at boot.
  Reserve `@Middleware()` for response short-circuit / stream mutation /
  pre-route-matching work.

  Two ground rules around the data flow — both stem from the fact that
  every per-request stage gets its OWN `RequestContext` instance, all
  reading/writing the SAME `AsyncLocalStorage`-backed Map:
  - **`resolve` and `onError` must RETURN the value.** The runner
    writes it via `ctx.set(reg.key, value)` on your behalf. Direct
    property assignment (`ctx.tenant = …`) sticks to the contributor
    instance only — the handler instance never sees it.
  - **Read across instances via `ctx.set` / `ctx.get`** (or
    `getRequestValue(key)` from a service that has no `ctx` reference
    — typed via `MetaValue<K>`). `ctx.req` works because the underlying
    Express request is shared; bespoke property assignments don't.

- **Test isolation** — default to `Container.create()` for fresh DI state.
  Never `new Container()` and never `getInstance().reset()` — both leak
  registrations between tests.

  ```ts
  const container = Container.create()
  // ... register test-scoped providers, run, discard
  ```

- **Bootstrap export** — `src/index.ts` MUST end with
  `export const app = await bootstrap({ ... })`. The Vite plugin imports
  the named `app` symbol to drive HMR module swaps; testing helpers
  (`createTestApp`) and the OpenAPI introspector also rely on it. Drop
  the `export` and `kick dev` will silently fall back to a full restart
  on every save while `createTestApp` complains about a missing handle.

- **Keep `src/index.ts` thin** — collect plugins, modules, middleware, and
  adapters in dedicated folders and re-export aggregated arrays. Do **not**
  inline registration in the entry file:

  ```ts
  // src/modules/index.ts
  export const modules: AppModuleClass[] = [HelloModule, UsersModule, ...]

  // src/middleware/index.ts
  export const middleware = [helmet(), cors(), requestId(), ...]

  // src/plugins/index.ts
  export const plugins = [MetricsPlugin(), AuditPlugin()]

  // src/adapters/index.ts
  export const adapters = [SwaggerAdapter({ ... }), DevToolsAdapter()]
  ```

  ```ts
  // src/index.ts — stays small; one import per category
  import 'reflect-metadata'
  import './config'
  import { bootstrap } from '@forinda/kickjs'
  import { modules } from './modules'
  import { middleware } from './middleware'
  import { plugins } from './plugins'
  import { adapters } from './adapters'

  export const app = await bootstrap({ modules, middleware, plugins, adapters })
  ```

  This keeps the entry file diff-friendly, scales to dozens of modules
  without git churn, and lets each domain own its own registration list.
  The generators (`kick g module`, `kick g middleware`, `kick g plugin`,
  `kick g adapter`) follow this layout — manual additions should too.

Everything else (controllers, services, modules, RequestContext API, generators,
package additions, env access patterns, troubleshooting) is detailed below.

## Where to Find Things

### Application Structure

| What                  | Where                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Entry point           | `src/index.ts`                                                                                    |
| Module registry       | `src/modules/index.ts`                                                                            |
| Feature modules       | `src/modules/<module-name>/`                                                                      |
| **Module entry file** | `src/modules/<name>/<name>.module.ts` (filename suffix is required — see Vite HMR contract below) |
| Env values            | `.env`                                                                                            |
| Env schema (Zod)      | `src/config/index.ts`                                                                             |
| TypeScript config     | `tsconfig.json`                                                                                   |
| Vite config (HMR)     | `vite.config.ts`                                                                                  |
| Vitest config         | `vitest.config.ts`                                                                                |
| Prettier config       | `.prettierrc`                                                                                     |
| CLI config            | `kick.config.ts`                                                                                  |

### Module Pattern (MINIMAL)

> **Vite HMR auto-discovery contract:** module files **must** be named `<name>.module.ts` (or `.tsx`/`.js`/`.jsx`) and live under `src/modules/`. The Vite plugin scans for `*.module.[tj]sx?` to drive graceful HMR rebuilds; renaming a file to `projects.ts` (no `.module`) silently breaks HMR — saves trigger a full restart instead of a swap. The CLI generator (`kick g module <name>`) follows the convention; manual files must too.

Each module in `src/modules/<name>/` typically contains:

```
src/
├── index.ts                 # Add routes here
└── ...                      # Custom structure
```

## Checklist: Adding a Feature

### New Module (Recommended)

Use the CLI generator for consistency:

```bash
kick g module <name>              # Generate full module
# or
kick g scaffold <name> <fields>   # Generate CRUD from fields
```

Then:

- [ ] Review generated files in `src/modules/<name>/`
- [ ] Verify module is registered in `src/modules/index.ts`
- [ ] Update DTOs in `<name>.dto.ts` if needed
- [ ] Implement business logic in `<name>.service.ts`
- [ ] Run `kick dev` to test with HMR
- [ ] Write tests in `<name>.test.ts`

### Manual Controller

If not using generators:

- [ ] Create `src/modules/<name>/<name>.controller.ts`
- [ ] Add `@Controller()` decorator
- [ ] Add route handlers with `@Get()`, `@Post()`, etc.
- [ ] Create module file implementing `AppModule` with `routes()` returning `{ path, router: buildRoutes(Controller), controller }`
- [ ] Register module in `src/modules/index.ts` (`AppModuleClass[]` array)
- [ ] Test with `kick dev`

### Manual Service

- [ ] Create `src/modules/<name>/<name>.service.ts`
- [ ] Add `@Service()` decorator
- [ ] Inject dependencies with `@Autowired()`
- [ ] Inject via `@Autowired()` where needed
- [ ] Write unit tests

### New Middleware

- [ ] Create `src/middleware/<name>.middleware.ts`
- [ ] Export middleware function (Express format)
- [ ] Register in `src/index.ts` or attach to routes with `@Middleware()`
- [ ] Test with sample requests

### Adding a Package

Use `kick add` to install KickJS packages with correct peer dependencies:

- [ ] Run `kick add <package>` (e.g., `kick add auth`)
- [ ] Follow package-specific setup in terminal output
- [ ] Update `src/index.ts` to register adapter (if needed)
- [ ] Configure environment variables in `.env`
- [ ] Test integration with `kick dev`

## Common Tasks

### Generate CRUD Module

```bash
kick g scaffold user name:string email:string:optional age:number
```

Append `:optional` for optional fields (shell-safe, no quoting needed).
Quoted `?` syntax also works: `"email:string?"` or `"email?:string"`.

This creates a full CRUD module with:

- Controller with GET, POST, PUT, DELETE routes
- Service with business logic
- Repository with data access
- DTOs with Zod validation

### Add Authentication

```bash
kick add auth
```

Then configure in `src/index.ts`:

```ts
import { AuthAdapter, JwtStrategy } from '@forinda/kickjs-auth'

bootstrap({
  modules,
  adapters: [
    AuthAdapter({
      strategies: [JwtStrategy({ secret: process.env.JWT_SECRET! })],
    }),
  ],
})
```

### Add Database (Prisma)

```bash
kick add prisma
pnpm install prisma @prisma/client
npx prisma init
# Edit prisma/schema.prisma
npx prisma migrate dev --name init
kick g module user --repo prisma
```

### Add WebSocket Support

```bash
kick add ws
```

Then add adapter in `src/index.ts`:

```ts
import { WsAdapter } from '@forinda/kickjs-ws'

bootstrap({
  modules,
  adapters: [WsAdapter()],
})
```

Create WebSocket controller:

```bash
kick g controller chat --ws
```

## Testing Guidelines

All tests use Vitest:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

describe('UserController', () => {
  it('should return users', async () => {
    // Container.create() — isolated DI state per test, never new Container()
    // and never getInstance().reset() (both leak registrations between tests).
    const container = Container.create()
    const app = await createTestApp([UserModule], { container })
    const res = await app.get('/users')

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('users')
  })
})
```

Run tests:

- `pnpm run test` — run all tests once
- `pnpm run test:watch` — watch mode
- Individual file: `pnpm run test src/modules/user/user.test.ts`

## Environment Variables

Schema is declared in `src/config/index.ts` (extends the base
`PORT`/`NODE_ENV`/`LOG_LEVEL` shape via `defineEnv`) and registered
with kickjs at module load. `src/index.ts` imports it via
`import './config'` **before** `bootstrap()` so the cache is populated
in time for DI. Add new keys to the schema, drop their values into
`.env`, and they're typed everywhere.

Access patterns:

1. **@Value() decorator** (recommended for known-at-construction keys):

```ts
@Value('DATABASE_URL')
private dbUrl!: string
```

2. **ConfigService** (recommended for dynamic / method-scoped access):

```ts
@Autowired()
private config!: ConfigService

const port = this.config.get('PORT')  // typed: number
```

3. **Standalone utilities** (no DI — works in scripts, CLI, plain files):

```ts
import { loadEnv, getEnv, reloadEnv, resetEnvCache } from '@forinda/kickjs/config'

const env = loadEnv(schema) // Parse + validate all vars
const port = getEnv('PORT') // Single value lookup
reloadEnv() // Re-read .env from disk
resetEnvCache() // Full reset (for tests)
```

4. **Direct `process.env`** — avoid in app code; bypasses Zod
   coercion and the typed `KickEnv` registry.

> **Pitfall**: never delete `import './config'` from `src/index.ts`.
> If the schema is not registered before DI runs, `config.get()`
> returns `undefined` for user keys (the base shape only) and
> `@Value()` only works because of its raw `process.env` fallback —
> Zod coercion + schema defaults are silently skipped.

## Standalone Utilities (No DI Required)

These work anywhere — scripts, plain files, outside `@Service`/`@Controller`:

| Utility                | Import            | Example                                           |
| ---------------------- | ----------------- | ------------------------------------------------- |
| `Logger.for(name)`     | `@forinda/kickjs` | `const log = Logger.for('MyScript')`              |
| `createLogger(name)`   | `@forinda/kickjs` | `const log = createLogger('Worker')`              |
| `createToken<T>(name)` | `@forinda/kickjs` | `const TOKEN = createToken<string>('app/db/url')` |
| `ref(value)`           | `@forinda/kickjs` | `const count = ref(0)`                            |
| `computed(fn)`         | `@forinda/kickjs` | `const doubled = computed(() => count.value * 2)` |
| `watch(source, cb)`    | `@forinda/kickjs` | `watch(() => count.value, (v) => log(v))`         |
| `reactive(obj)`        | `@forinda/kickjs` | `const state = reactive({ count: 0 })`            |
| `HttpException`        | `@forinda/kickjs` | `throw new HttpException(404, 'Not found')`       |
| `HttpStatus`           | `@forinda/kickjs` | `HttpStatus.NOT_FOUND // 404`                     |

## Key Decorators

### HTTP Routes

| Decorator               | Purpose                           |
| ----------------------- | --------------------------------- |
| `@Controller()`         | Define route prefix               |
| `@Get('/'), @Post('/')` | HTTP method handlers              |
| `@Middleware(fn)`       | Attach middleware                 |
| `@Public()`             | Skip auth (requires auth adapter) |
| `@Roles('admin')`       | Role-based access                 |

### Dependency Injection

| Decorator             | Purpose                                       |
| --------------------- | --------------------------------------------- |
| `AppModule` interface | Define feature module (implements `routes()`) |
| `@Service()`          | Register singleton service                    |
| `@Repository()`       | Register repository                           |
| `@Autowired()`        | Property injection                            |
| `@Inject('token')`    | Token-based injection                         |
| `@Value('VAR')`       | Inject env variable                           |

### Context Decorators

Typed, ordered way to populate `ctx.set/get` keys before the handler runs.
Use this **instead of `@Middleware()`** when the middleware's only output
is a value other code reads off `ctx`.

| Concept                                                                        | Where it lives                                                       |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `defineContextDecorator({ key, deps, dependsOn, optional, onError, resolve })` | `@forinda/kickjs`                                                    |
| Method/class decorator                                                         | `@LoadX` on a controller method/class                                |
| Module hook                                                                    | `AppModule.contributors?(): ContributorRegistration[]`               |
| Adapter hook                                                                   | `AppAdapter.contributors?(): ContributorRegistration[]`              |
| Global registration                                                            | `bootstrap({ contributors: [LoadX.registration] })`                  |
| Type augmentation                                                              | `declare module '@forinda/kickjs' { interface ContextMeta { ... } }` |

Precedence high → low: **method > class > module > adapter > global**.
Cycles and missing `dependsOn` keys throw at `app.setup()` (boot fails
fast). The `onError` hook is async-permitted.

Full guide: <https://forinda.github.io/kick-js/guide/context-decorators>.

## Common Pitfalls

1. **Forgot to register module** — Add to `src/modules/index.ts` exports array
2. **DI not working** — Ensure `reflect-metadata` is imported in `src/index.ts`
3. **Tests failing randomly** — Sharing the global container between tests. Default to `Container.create()` per test (or per `beforeEach`) instead of `new Container()` / `getInstance().reset()`
4. **Routes not found** — Check controller path and module registration
5. **HMR not working** — Two checks: (a) `vite.config.ts` has `hmr: true`; (b) module file is named `<name>.module.ts` (or `.tsx`/`.js`/`.jsx`) and lives under `src/modules/`. The Vite plugin auto-discovers `*.module.[tj]sx?` for graceful HMR — a misnamed module file (e.g., `projects.ts`) silently degrades to a full restart on every save.
6. **Decorators not working** — Check `tsconfig.json` has `experimentalDecorators: true`
7. **`config.get('YOUR_KEY')` returns `undefined`** — `src/index.ts` is missing `import './config'`. That side-effect import registers the env schema with kickjs (`loadEnv(envSchema)` runs at module load). Without it, `ConfigService` falls back to the base schema (`PORT`/`NODE_ENV`/`LOG_LEVEL` only) and every user-defined key reads as `undefined`. `@Value()` may _appear_ to work because of a raw `process.env` fallback, but Zod coercion and schema defaults are silently skipped — investigate `src/index.ts` and `src/config/index.ts` first.
8. **Used `@Middleware()` to compute a value for `ctx`** — prefer `defineContextDecorator()` (see Context Decorators above). It's typed via `ContextMeta`, supports `dependsOn` for ordering, and validates the pipeline at boot. `@Middleware()` is for response short-circuiting, stream mutation, and pre-route-matching work.
9. **Context contributor's `dependsOn` key not produced anywhere** — boot throws `MissingContributorError` naming the dependent and the route. Either remove the dep or register a contributor that produces the key (at any precedence level: method/class/module/adapter/global).
10. **`bootstrap()` not exported** — `src/index.ts` calls `await bootstrap({ ... })` but discards the return value (no `export const app = ...`). Vite HMR can't locate the running instance, so module saves degrade to full restarts; `createTestApp`/`@forinda/kickjs-testing` consumers can't import the handle either. Always: `export const app = await bootstrap({ ... })`.
11. **Refresh AGENTS.md / CLAUDE.md after a framework upgrade** — these files are scaffolded by the CLI and don't auto-update. Run `kick g agents -f` (or `kick g agent-docs -f`) to regenerate from the latest CLI templates after `kick add` / version bumps. Hand-edited sections will be overwritten — keep customisation in a separate file like `AGENTS.local.md`.

## CLI Commands Reference

| Command                           | Description                  |
| --------------------------------- | ---------------------------- |
| `kick dev`                        | Dev server with HMR          |
| `kick dev:debug`                  | Dev server with debugger     |
| `kick build`                      | Production build             |
| `kick start`                      | Run production build         |
| `kick g module <names...>`        | Generate one or more modules |
| `kick g scaffold <name> <fields>` | Generate CRUD                |
| `kick g controller <name>`        | Generate controller          |
| `kick g service <name>`           | Generate service             |
| `kick g middleware <name>`        | Generate middleware          |
| `kick add <package>`              | Add KickJS package           |
| `kick add --list`                 | List available packages      |
| `kick rm module <names...>`       | Remove one or more modules   |

> **Note:** When using `kick new` in scripts or CI, pass `-t` (or `--template`) and `-r` (or `--repo`) flags to bypass interactive prompts:
>
> ```bash
> kick new my-api -t ddd -r prisma --pm pnpm --no-git --no-install -f
> ```

## Learn More

- [KickJS Docs](https://forinda.github.io/kick-js/)
- [CLI Reference](https://forinda.github.io/kick-js/api/cli.html)
- [Decorators Guide](https://forinda.github.io/kick-js/guide/decorators.html)
- [DI System](https://forinda.github.io/kick-js/guide/dependency-injection.html)
- [Testing](https://forinda.github.io/kick-js/api/testing.html)
