# AGENTS.md — AI Agent Guide for multi-tenant-prisma-api

This guide helps AI agents (Claude, Copilot, etc.) work effectively on this KickJS application.

## Before You Start

1. Read `CLAUDE.md` for project conventions and commands
2. Run `pnpm install` to install dependencies
3. Run `kick dev` to verify the app starts
4. Read the [KickJS documentation](https://forinda.github.io/kick-js/) for framework details

## Where to Find Things

### Application Structure

| What | Where |
|------|-------|
| Entry point | `src/index.ts` |
| Module registry | `src/modules/index.ts` |
| Feature modules | `src/modules/<module-name>/` |
| Env values | `.env` |
| Env schema (Zod) | `src/config/index.ts` |
| TypeScript config | `tsconfig.json` |
| Vite config (HMR) | `vite.config.ts` |
| Vitest config | `vitest.config.ts` |
| Prettier config | `.prettierrc` |
| CLI config | `kick.config.ts` |

### Module Pattern (MINIMAL)

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
- [ ] Add `@Controller('/path')` decorator
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
    new AuthAdapter({
      strategies: [new JwtStrategy({ secret: process.env.JWT_SECRET! })],
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
  adapters: [new WsAdapter()],
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
  beforeEach(() => {
    Container.reset()  // Important: isolate DI state
  })

  it('should return users', async () => {
    const app = await createTestApp([UserModule])
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

const env = loadEnv(schema)         // Parse + validate all vars
const port = getEnv('PORT')         // Single value lookup
reloadEnv()                         // Re-read .env from disk
resetEnvCache()                     // Full reset (for tests)
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

| Utility | Import | Example |
|---------|--------|---------|
| `Logger.for(name)` | `@forinda/kickjs` | `const log = Logger.for('MyScript')` |
| `createLogger(name)` | `@forinda/kickjs` | `const log = createLogger('Worker')` |
| `createToken<T>(name)` | `@forinda/kickjs` | `const TOKEN = createToken<string>('db.url')` |
| `ref(value)` | `@forinda/kickjs` | `const count = ref(0)` |
| `computed(fn)` | `@forinda/kickjs` | `const doubled = computed(() => count.value * 2)` |
| `watch(source, cb)` | `@forinda/kickjs` | `watch(() => count.value, (v) => log(v))` |
| `reactive(obj)` | `@forinda/kickjs` | `const state = reactive({ count: 0 })` |
| `HttpException` | `@forinda/kickjs` | `throw new HttpException(404, 'Not found')` |
| `HttpStatus` | `@forinda/kickjs` | `HttpStatus.NOT_FOUND // 404` |

## Key Decorators

### HTTP Routes
| Decorator | Purpose |
|-----------|---------|
| `@Controller('/path')` | Define route prefix |
| `@Get('/'), @Post('/')` | HTTP method handlers |
| `@Middleware(fn)` | Attach middleware |
| `@Public()` | Skip auth (requires auth adapter) |
| `@Roles('admin')` | Role-based access |

### Dependency Injection
| Decorator | Purpose |
|-----------|---------|
| `AppModule` interface | Define feature module (implements `routes()`) |
| `@Service()` | Register singleton service |
| `@Repository()` | Register repository |
| `@Autowired()` | Property injection |
| `@Inject('token')` | Token-based injection |
| `@Value('VAR')` | Inject env variable |

## Common Pitfalls

1. **Forgot to register module** — Add to `src/modules/index.ts` exports array
2. **DI not working** — Ensure `reflect-metadata` is imported in `src/index.ts`
3. **Tests failing randomly** — Missing `Container.reset()` in `beforeEach`
4. **Routes not found** — Check controller path and module registration
5. **HMR not working** — Verify `vite.config.ts` has `hmr: true`
6. **Decorators not working** — Check `tsconfig.json` has `experimentalDecorators: true`
7. **`config.get('YOUR_KEY')` returns `undefined`** — `src/index.ts` is missing `import './config'`. That side-effect import registers the env schema with kickjs (`loadEnv(envSchema)` runs at module load). Without it, `ConfigService` falls back to the base schema (`PORT`/`NODE_ENV`/`LOG_LEVEL` only) and every user-defined key reads as `undefined`. `@Value()` may *appear* to work because of a raw `process.env` fallback, but Zod coercion and schema defaults are silently skipped — investigate `src/index.ts` and `src/config/index.ts` first.

## CLI Commands Reference

| Command | Description |
|---------|-------------|
| `kick dev` | Dev server with HMR |
| `kick dev:debug` | Dev server with debugger |
| `kick build` | Production build |
| `kick start` | Run production build |
| `kick g module <names...>` | Generate one or more modules |
| `kick g scaffold <name> <fields>` | Generate CRUD |
| `kick g controller <name>` | Generate controller |
| `kick g service <name>` | Generate service |
| `kick g middleware <name>` | Generate middleware |
| `kick add <package>` | Add KickJS package |
| `kick add --list` | List available packages |
| `kick rm module <names...>` | Remove one or more modules |

> **Note:** When using `kick new` in scripts or CI, pass `-t` (or `--template`) and `-r` (or `--repo`) flags to bypass interactive prompts:
> ```bash
> kick new my-api -t ddd -r prisma --pm pnpm --no-git --no-install -f
> ```

## Learn More

- [KickJS Docs](https://forinda.github.io/kick-js/)
- [CLI Reference](https://forinda.github.io/kick-js/api/cli.html)
- [Decorators Guide](https://forinda.github.io/kick-js/guide/decorators.html)
- [DI System](https://forinda.github.io/kick-js/guide/dependency-injection.html)
- [Testing](https://forinda.github.io/kick-js/api/testing.html)
