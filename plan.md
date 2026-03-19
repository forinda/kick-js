# KickJS Framework — Architecture & Implementation Plan

> Living document. Update as phases complete and architecture evolves.

---

## Current State (v0.3.0-alpha)

Re-architected from a single-package library (`@forinda/kickjs` v0.2.0) into a composable monorepo ecosystem. Replaced Inversify with a custom lightweight DI container. Moved to ESM, pnpm workspaces, Turborepo, and Vite-based HMR.

### Completed

- [x] **Monorepo setup** — pnpm workspaces + Turborepo build orchestration
- [x] **`@kickjs/core`** — Custom IoC container, 20+ decorators, module system, adapter interface, logger, errors
- [x] **`@kickjs/http`** — Express 5 Application, router builder, RequestContext, middleware (requestId, validate, errorHandler)
- [x] **`@kickjs/config`** — Zod-based env validation with `defineEnv()` extension, ConfigService
- [x] **`@kickjs/cli`** — `kick new`, `kick g module` (full DDD scaffold), `kick dev`/`build`/`start`, custom command interface
- [x] **`@kickjs/testing`** — `createTestApp`, `createTestModule` helpers
- [x] **Vite HMR** — `kick dev` uses `vite-node --watch` for zero-downtime reload via `Application.rebuild()`
- [x] **Custom CLI commands** — Developers extend the CLI via `kick.config.ts` with `defineConfig({ commands: [...] })`
- [x] **Working example** — `examples/basic-api` with full DDD Todo module
- [x] **All packages build successfully** — 6 framework packages + 1 example, ESM + DTS
- [x] **Pluggable Swagger** — `SchemaParser` interface, Zod default, custom override for Yup/Joi/Valibot
- [x] **Query system** — ORM-agnostic `parseQuery()`, `ctx.qs()`, `QueryBuilderAdapter` for Drizzle/Prisma/Sequelize
- [x] **CSRF middleware** — Double-submit cookie pattern
- [x] **Upload middleware** — Multer wrapper with auto-cleanup
- [x] **Production hardening** — Error logging, shutdown resilience, `@Value` safety, validation DRY, HMR reset
- [x] **Integration tests** — 66 tests across Container, router-builder, Application, query parser
- [x] **CI pipeline** — GitHub Actions with Node 20/22 matrix
- [x] **README** — Full rewrite for v0.3.0 monorepo

---

## Repository Structure

```
kick-js/
├── packages/
│   ├── core/           @kickjs/core        — DI container, decorators, module system, logger, errors
│   ├── http/           @kickjs/http        — Express 5 app, router builder, RequestContext, middleware
│   ├── config/         @kickjs/config      — Zod env validation, ConfigService, @Value
│   ├── cli/            @kickjs/cli         — CLI binary (kick), generators, custom commands
│   └── testing/        @kickjs/testing     — Test utilities, TestModule builder
├── examples/
│   └── basic-api/                          — Full DDD todo API (runnable)
├── docs/                                   — Documentation (planned)
├── turbo.json                              — Turborepo task config
├── pnpm-workspace.yaml                     — Workspace definition
├── tsconfig.base.json                      — Shared TS config
└── plan.md                                 — This file
```

---

## Package Dependency Graph

```
@kickjs/testing ──> @kickjs/http ──> @kickjs/core
                                         ^
@kickjs/config ─────────────────────────┘

@kickjs/cli (standalone — generates code, no runtime dependency)
```

---

## Developer Experience (DX) — Priority

### CLI Commands

```bash
# ── Project lifecycle ──────────────────────────────────────────────────
kick new <project-name>          # Scaffold a new project with vite.config.ts, HMR, etc.
kick dev                         # Start dev server with Vite HMR (zero-downtime reload)
kick dev:debug                   # Dev server with Node.js inspector
kick build                       # Production build via Vite
kick start                       # Run production build (NODE_ENV=production)
kick info                        # Print framework version, Node version, OS info

# ── Code generation ───────────────────────────────────────────────────
kick g module <name>             # Full DDD module (entity, VOs, repo, service, use-cases, DTOs, controller)
kick g controller <module>/<name>
kick g use-case <module>/<name>
kick g service <module>/<name>
kick g repository <module>/<name>
kick g entity <module>/<name>
kick g dto <module>/<name>
kick g middleware <name>
kick g guard <name>
kick g adapter <name>
kick g schema <name>             # Drizzle table schema
kick g gateway <name>            # WebSocket gateway (requires @kickjs/websocket)
kick g worker <name>             # Queue worker (requires @kickjs/queue)

# ── Project tools ─────────────────────────────────────────────────────
kick routes                      # Print registered route table
kick doctor                      # Check project health (deps, config, DB connection)
kick lint                        # Run ESLint
kick format                      # Run Prettier
kick test                        # Run Vitest
```

### Generator Flags

```bash
kick g module orders --no-entity       # Skip entity/value objects
kick g module orders --no-tests        # Skip test file generation
kick g module orders --repo inmemory   # Use InMemory instead of Drizzle
kick g module orders --repo drizzle    # Use Drizzle (default when @kickjs/database installed)
kick g module orders --crud            # Include all CRUD use-cases (default)
kick g module orders --minimal         # Only index.ts + controller
kick g module orders --dry-run         # Preview files without writing
kick g module orders --flat            # No DDD nesting (presentation-only)
```

### Custom Command Interface — `kick.config.ts`

Developers extend the CLI with project-specific commands. When Drizzle, Prisma, protobuf, or any tool is added to a project, devs register the commands once and the whole team uses `kick db:migrate` etc.

```typescript
import { defineConfig } from '@kickjs/cli'

export default defineConfig({
  modulesDir: 'src/modules',
  defaultRepo: 'drizzle',
  schemaDir: 'src/db/schema',

  commands: [
    {
      name: 'db:generate',
      description: 'Generate Drizzle migrations from schema',
      steps: 'npx drizzle-kit generate',
    },
    {
      name: 'db:migrate',
      description: 'Run database migrations',
      steps: 'npx drizzle-kit migrate',
    },
    {
      name: 'db:push',
      description: 'Push schema directly (dev only)',
      steps: 'npx drizzle-kit push',
    },
    {
      name: 'db:studio',
      description: 'Open Drizzle Studio GUI',
      steps: 'npx drizzle-kit studio',
    },
    {
      name: 'db:seed',
      description: 'Run seed files',
      steps: 'npx tsx src/db/seed.ts',
    },
    {
      name: 'proto:gen',
      description: 'Generate TypeScript from protobuf definitions',
      steps: ['npx buf generate', 'echo "Protobuf types generated"'],
    },
  ],

  style: {
    semicolons: false,
    quotes: 'single',
    trailingComma: 'all',
    indent: 2,
  },
})
```

### HMR Architecture

```
kick dev  →  vite-node --watch src/index.ts
                 │
                 ▼
         File change detected
                 │
                 ▼
     import.meta.hot.accept()
                 │
                 ▼
      main() re-executes
                 │
      ┌──────────┴──────────┐
      │  g.__app exists?     │
      │  YES → app.rebuild() │
      │  NO  → app.start()   │
      └──────────────────────┘
                 │
          rebuild() does:
     1. Create fresh Express app
     2. Re-run setup() (middleware + routes)
     3. Swap handler on existing http.Server
                 │
         ┌───────┴───────┐
         │  Preserved:    │
         │  • HTTP server │
         │  • DB pool     │
         │  • Redis conn  │
         │  • Socket.IO   │
         │  • Port binding│
         └───────────────┘
```

### DX Features To Implement

| Feature | Status | Notes |
|---------|--------|-------|
| Auto-import registration — generator adds module to `src/modules/index.ts` | Done | |
| Circular dependency detection with full chain printed | Done | Container prints `A -> B -> C -> A` chain |
| Missing binding hints (Levenshtein distance suggestions) | Pending | When `resolve()` fails |
| Route table command (`kick routes`) | Pending | Print methods, paths, middleware, controller |
| Startup banner with version, env, port, module count | Pending | ASCII art optional |
| Watch mode intelligence — ignore test files | Pending | vite.config.ts `server.watch.ignored` |
| Error overlay with source maps in terminal | Pending | |

---

## Phase 1 — Core Stabilization (Current)

### Priority: Get the foundation production-ready

| Task | Status | Notes |
|------|--------|-------|
| Container: constructor injection with `@Inject` | Done | |
| Container: property injection with `@Autowired` | Done | Lazy getter pattern |
| Container: `@PostConstruct` lifecycle hook | Done | |
| Container: `@Configuration` + `@Bean` factories | Done | |
| Container: `registerFactory` for lazy resolution | Done | Avoids DI timing issues |
| Container: circular dependency detection | Done | Full resolution chain in error message |
| HTTP decorators: `@Get/@Post/@Put/@Delete/@Patch` | Done | With Zod validation |
| `RequestContext` with response helpers | Done | json, created, noContent, notFound, badRequest, html, download |
| `Application` lifecycle: setup, start, shutdown, rebuild | Done | HMR-aware |
| Error handling: `HttpException` with static factories | Done | badRequest through internal (400-500) |
| Middleware: requestId, validate, errorHandler | Done | |
| `@Value('ENV_KEY')` environment injection | Done | Container-based injection, throws on missing |
| Logger: Pino wrapper with `createLogger(name)` | Done | Pretty in dev, JSON in prod |
| `@Controller(path)` with route prefix | Done | |
| `@Middleware(handler)` class + method level | Done | |
| `@FileUpload(config)` decorator | Done | Metadata only — handler in http |
| `@Transactional()` decorator | Done | Requires TransactionManager in container |
| `@Builder` decorator | Done | Fluent builder pattern |
| CLI: `kick new <name>` scaffolding | Done | Includes vite.config.ts, HMR entry |
| CLI: `kick g module <name>` DDD generation | Done | Full CRUD scaffold, auto-register |
| CLI: `kick dev` with Vite HMR | Done | vite-node --watch |
| CLI: `kick build` via Vite | Done | vite build |
| CLI: `kick start` production | Done | NODE_ENV=production node dist/ |
| CLI: `kick dev:debug` with inspector | Done | vite-node --inspect --watch |
| CLI: Custom command interface (`kick.config.ts`) | Done | `defineConfig({ commands: [...] })` |
| Testing: `createTestApp` helper | Done | Empty middleware pipeline for clean tests |
| Testing: `createTestModule` builder | Done | |
| Example: basic-api with DDD todos | Done | Runnable, full CRUD |
| Write integration tests for Container | Done | 19 tests — scopes, DI, `@Inject`, `@Autowired`, `@Value`, `@PostConstruct`, circular |
| Write integration tests for router-builder | Done | 7 tests — paths, methods, validation, middleware |
| Write integration tests for Application lifecycle | Done | 9 tests — adapters, shutdown, HMR rebuild, multi-module |
| Write integration tests for query parser | Done | 31 tests — filters, sort, pagination, search, round-trip |
| Write E2E tests for CLI generators | Pending | |
| CSRF middleware (`csrf()`) | Done | Double-submit cookie pattern, `ignorePaths` |
| Upload middleware with cleanup | Done | `upload.single/array/none`, `cleanupFiles()` |
| Query system (filter, sort, pagination) | Done | `parseQuery`, `ctx.qs()`, `QueryBuilderAdapter` for ORM adapters |
| Pluggable Swagger schema parser | Done | `SchemaParser` interface, Zod default, Yup/Joi/Valibot override |
| Error handler logging | Done | Pino logging, `headersSent` guard |
| Validation middleware deduplication | Done | Single source in `validate.ts` |
| HMR container reset | Done | `rebuild()` calls `Container.reset()` |
| Graceful shutdown resilience | Done | `Promise.allSettled()` for adapter shutdowns |
| Set up CI pipeline (GitHub Actions) | Done | Matrix Node 20/22, lint + build + test |
| Publish v0.3.0-alpha to npm | Pending | |

---

## Phase 2 — Ecosystem Packages

### Packages to build after Phase 1 is stable

| Package | Description | Priority | Source |
|---------|-------------|----------|--------|
| `@kickjs/swagger` | OpenAPI spec generation from decorators, Swagger UI + ReDoc | High | Port from template |
| `@kickjs/database` | Drizzle adapter, DatabaseService, transaction propagation | High | Port from template |
| `@kickjs/auth` | JWT strategy, `@Authenticated`, `@Roles`, guards, session | High | New |
| `@kickjs/mail` | Pluggable transport (Resend, SMTP), EJS template rendering | Medium | Port from template |
| `@kickjs/cache` | `@Cacheable`, `@CacheEvict`, `@CachePut`, Redis/in-memory | Medium | New |
| `@kickjs/websocket` | Socket.IO adapter with `@Gateway`, `@OnEvent` decorators | Medium | New |
| `@kickjs/queue` | BullMQ job processing with `@Worker` decorator | Medium | New |
| `@kickjs/devtools` | Dev dashboard at `/__dev`, DI graph visualizer | Low | New |

### Swagger Package Design (`@kickjs/swagger`)

```typescript
// Decorators
@ApiOperation({ summary: 'Create a todo' })
@ApiResponse({ status: 201, description: 'Created' })
@ApiTags('Todos')
@ApiBearerAuth()
@ApiExclude()

// Adapter — serves docs at /docs, /redoc, /openapi.json
new SwaggerAdapter({
  info: { title: 'My API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  bearerAuth: true,
})

// buildOpenAPISpec() — introspects controllers + Zod schemas → OpenAPI 3.0.3
```

### Database Package Design (`@kickjs/database`)

```typescript
// DatabaseAdapter — connection lifecycle, registers in DI
new DatabaseAdapter({ url: env.DATABASE_URL, schema, maxConnections: 10, ssl: 'require' })

// DatabaseService — .active getter for transparent transaction propagation
@Repository()
class DrizzleUserRepo {
  @Autowired() private db!: DatabaseService
  async findAll() {
    return this.db.active.select().from(users)  // joins current tx automatically
  }
}

// @Transactional() — auto begin/commit/rollback via AsyncLocalStorage
@Transactional()
async registerUser(dto: RegisterDTO) {
  await this.userRepo.create(dto)
  await this.profileRepo.create(dto.userId)
  // both in same transaction — rolls back together on error
}

// Multi-database support
const primary = new DatabaseAdapter({ name: 'primary', url: '...' })
const analytics = new DatabaseAdapter({ name: 'analytics', url: '...', readOnly: true })

// Query builders
const { where, orderBy, limit, offset } = buildDrizzleQuery(parsedQuery, {
  columns: { name: users.name, email: users.email },
  searchColumns: [users.name, users.email],
})
```

### Auth Package Design (`@kickjs/auth`)

```typescript
// Decorators
@Controller('/admin')
@Authenticated()
@Roles('admin')
export class AdminController {
  @Get('/dashboard')
  async dashboard(ctx: RequestContext) {
    const user = ctx.get<AuthUser>('auth')
  }

  @Post('/public-endpoint')
  @Public()  // Opt out of global auth
  async publicEndpoint(ctx: RequestContext) { ... }
}

// Strategy pattern
AuthModule.forRoot({ strategy: new JwtStrategy() })
AuthModule.forRoot({ strategy: new ApiKeyStrategy() })
AuthModule.forRoot({ strategy: new OAuth2Strategy({ provider: 'google', ... }) })

// AuthService — injectable
@Service()
class AuthService {
  hashPassword(password: string): Promise<string>
  comparePassword(password: string, hash: string): Promise<boolean>
  generateToken(payload: object): string
  verifyToken(token: string): object
}
```

### Cache Package Design (`@kickjs/cache`)

```typescript
@Service()
export class ProductService {
  @Cacheable({ key: 'product:{id}', ttl: 300 })
  async findById(id: string): Promise<Product> { ... }

  @CachePut({ key: 'product:{id}' })
  async update(id: string, data: UpdateDTO): Promise<Product> { ... }

  @CacheEvict({ key: 'product:{id}' })
  async delete(id: string): Promise<void> { ... }
}

// Store options
CacheModule.forRoot({ store: new RedisStore(env.REDIS_URL) })
CacheModule.forRoot({ store: new InMemoryStore() })
```

### WebSocket Package Design (`@kickjs/websocket`)

```typescript
@Gateway('/chat')
export class ChatGateway {
  @Autowired() private chatService!: ChatService

  @OnConnect()
  async handleConnection(socket: Socket) { ... }

  @OnEvent('message')
  async handleMessage(socket: Socket, data: { room: string; text: string }) {
    const saved = await this.chatService.saveMessage(data)
    socket.to(data.room).emit('message', saved)
  }

  @OnDisconnect()
  async handleDisconnect(socket: Socket) { ... }
}
```

### Queue Package Design (`@kickjs/queue`)

```typescript
@Service()
export class EmailQueue {
  @Inject(QUEUE) private queue!: Queue

  async enqueue(to: string, template: string, data: object) {
    await this.queue.add('send-email', { to, template, data })
  }
}

@Worker('send-email')
export class EmailWorker {
  @Autowired() private mail!: MailService

  async process(job: Job<{ to: string; template: string; data: object }>) {
    await this.mail.sendTemplate(job.data)
  }
}
```

### Mail Package Design (`@kickjs/mail`)

```typescript
// Pluggable transports
MailModule.forRoot({ transport: new ResendTransport(apiKey) })
MailModule.forRoot({ transport: new SmtpTransport({ host, port, auth }) })

// MailService
await mailService.send({ to, subject, html })
await mailService.sendTemplate({ to, subject, template: 'welcome', data: { name } })

// DocumentService — EJS template rendering
const { html } = await documentService.render({ template: 'invoice', data: { items } })
```

---

## Phase 3 — CLI Enhancement

| Feature | Status | Notes |
|---------|--------|-------|
| `kick g module <name>` — full DDD scaffold | Done | Entity, VOs, repo, service, use-cases, controller |
| `kick g controller <module>/<name>` | Pending | Individual controller generation |
| `kick g use-case <module>/<name>` | Pending | |
| `kick g service <module>/<name>` | Pending | |
| `kick g repository <module>/<name>` | Pending | |
| `kick g entity <module>/<name>` | Pending | |
| `kick g dto <module>/<name>` | Pending | |
| `kick g middleware <name>` | Pending | |
| `kick g guard <name>` | Pending | |
| `kick g adapter <name>` | Pending | |
| `kick g schema <name>` | Pending | Drizzle table schema |
| `kick g gateway <name>` | Pending | Requires @kickjs/websocket |
| `kick g worker <name>` | Pending | Requires @kickjs/queue |
| `kick routes` — print route table | Pending | Methods, paths, middleware, controller |
| `kick doctor` — health check | Pending | Deps, config, DB connection |
| `--dry-run` flag for all generators | Pending | Preview files without writing |
| Auto-detect code style from prettier/eslint | Pending | |
| `kick.config.ts` custom command interface | Done | `defineConfig({ commands })` |

---

## Phase 4 — Plugin System

### Plugin Interface

Third-party packages can extend the framework with adapters, decorators, middleware, and CLI generators.

```typescript
export interface KickPlugin {
  /** Unique plugin name */
  name: string
  /** Adapters to register in the application lifecycle */
  adapters?(): AppAdapter[]
  /** Register services/factories in the DI container */
  register?(container: Container): void
  /** CLI schematics this plugin provides */
  schematics?(): SchematicDefinition[]
  /** Vite plugins for dev/build */
  vitePlugins?(): any[]
}
```

### Plugin Usage

```typescript
// Plugin definition
export const storagePlugin: KickPlugin = {
  name: '@kickjs-community/storage',
  adapters: () => [new S3StorageAdapter()],
  register: (container) => {
    container.registerFactory(STORAGE, () => container.resolve(S3StorageService))
  },
  schematics: () => [{
    name: 'storage-bucket',
    description: 'Generate a storage bucket configuration',
    generate: async (name, options) => { /* ... */ },
  }],
}

// Usage in application
const app = new Application({
  modules,
  adapters,
  plugins: [storagePlugin],
})
```

### Plugin Management CLI

```bash
kick plugin add @kickjs-community/storage    # Install + register
kick plugin list                              # List registered plugins
kick g storage-bucket avatars                 # Use plugin's generator
```

### Community Plugin Ideas

| Plugin | Description |
|--------|-------------|
| `@kickjs/graphql` | GraphQL schema-first or code-first with decorators |
| `@kickjs/grpc` | gRPC server/client with Protobuf codegen |
| `@kickjs/cron` | `@Cron('*/5 * * * *')` scheduled jobs |
| `@kickjs/events` | Domain event bus with `@EventHandler` |
| `@kickjs/i18n` | Internationalization with translation loading |
| `@kickjs-community/storage` | S3/GCS/Azure Blob file storage |
| `@kickjs-community/stripe` | Stripe payments integration |
| `@kickjs-community/sentry` | Sentry error tracking adapter |
| `@kickjs-community/prometheus` | Prometheus metrics endpoint |
| `@kickjs-community/opentelemetry` | Distributed tracing |
| `@kickjs-community/prisma` | Prisma as alternative to Drizzle |

---

## Phase 5 — Documentation & Community

| Task | Status |
|------|--------|
| VitePress documentation site | Pending |
| Getting Started guide | Pending |
| API reference (auto-generated from TSDoc) | Pending |
| Cookbook: REST API patterns | Pending |
| Cookbook: Auth with JWT | Pending |
| Cookbook: Real-time with WebSocket | Pending |
| Cookbook: Database with Drizzle | Pending |
| `create-kickjs-app` interactive scaffolder (npm init) | Pending |
| Example: basic-api (DDD todo CRUD) | Done |
| Example: auth-jwt (JWT auth with guards) | Pending |
| Example: realtime-chat (Socket.IO) | Pending |
| Example: microservices (multi-service) | Pending |
| Discord community | Pending |
| GitHub issue templates | Pending |
| Contributing guide | Existing (update for monorepo) |
| RFC process for major changes | Pending |

---

## Application Bootstrap (User-Facing API)

### Minimal App

```typescript
import { Application } from '@kickjs/http'
import { UserModule } from './modules/users'

const app = new Application({
  modules: [UserModule],
})

app.start()
```

### Full-Featured App

```typescript
import { Application } from '@kickjs/http'
import { DatabaseAdapter } from '@kickjs/database'
import { AuthModule, JwtStrategy } from '@kickjs/auth'
import { SwaggerAdapter } from '@kickjs/swagger'
import { MailModule, ResendTransport } from '@kickjs/mail'
import { CacheModule, RedisStore } from '@kickjs/cache'
import { QueueModule } from '@kickjs/queue'
import { WebSocketModule } from '@kickjs/websocket'
import { storagePlugin } from '@kickjs-community/storage'

const app = new Application({
  modules: [
    AuthModule.forRoot({ strategy: new JwtStrategy() }),
    UserModule,
    OrderModule,
    MailModule.forRoot({ transport: new ResendTransport(env.RESEND_KEY) }),
    CacheModule.forRoot({ store: new RedisStore(env.REDIS_URL) }),
    QueueModule.forRoot({ connection: env.REDIS_URL }),
    WebSocketModule.forRoot(),
  ],
  adapters: [
    new DatabaseAdapter({ url: env.DATABASE_URL, schema }),
    new SwaggerAdapter({ info: { title: 'My API', version: '1.0.0' } }),
  ],
  plugins: [storagePlugin],
})

app.start()
```

### Module `forRoot` / `forFeature` Pattern

```typescript
export class CacheModule {
  static forRoot(options: CacheModuleOptions): AppModuleClass {
    return class ConfiguredCacheModule implements AppModule {
      register(container: Container) {
        container.registerInstance(CACHE_OPTIONS, options)
        container.registerFactory(CACHE, () => {
          const store = options.store ?? new InMemoryStore()
          return new CacheService(store)
        })
      }
      routes() { return [] }
    }
  }

  static forFeature(options?: { prefix?: string }): AppModuleClass {
    // Module-scoped cache with key prefix
  }
}
```

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| DI Container | Custom (no Inversify) | Lightweight, no external dep, full control, simpler API |
| Module system | ESM only | Modern standard, tree-shaking, native Node.js support |
| Runtime | Node.js 20+ | LTS, native ESM, stable decorators path |
| HTTP | Express 5 | Mature, async middleware, wide ecosystem |
| Validation | Zod | Runtime + static types, composable, doubles as OpenAPI schema |
| ORM | Drizzle (default) | Type-safe, lightweight, SQL-first; Prisma via plugin |
| Build | tsup (esbuild + dts) for packages, Vite for apps | Fast builds, native HMR |
| Dev server | vite-node --watch | True HMR via import.meta.hot, not full restart |
| Monorepo | pnpm + Turborepo | Efficient deps, build caching, task orchestration |
| Test | Vitest | Fast, ESM-native, compatible API |
| Logging | Pino | Fastest Node.js logger, structured JSON in prod |
| Decorators | TypeScript experimental | Required for reflect-metadata; plan TC39 migration |
| CLI | Commander.js | Mature, small, well-documented |

---

## Competitive Positioning

| Feature | KickJS | NestJS | Fastify | Express |
|---------|--------|--------|---------|---------|
| DI container | Built-in (lightweight) | Built-in (heavy) | None | None |
| TypeScript decorators | Full | Full | None | None |
| DDD module structure | First-class generators | Partial | None | None |
| Code generation CLI | Yes (`kick g`) | Yes (`nest g`) | None | None |
| Drizzle ORM integration | Native (planned) | Community | Community | None |
| Zod validation | Native | Via pipes | Via plugin | None |
| OpenAPI from decorators | Automatic (planned) | Automatic | Via plugin | None |
| Vite HMR (backend) | Native | None | None | None |
| Transaction propagation | AsyncLocalStorage | TypeORM | None | None |
| Plugin system | Yes (planned) | Dynamic modules | Plugins | Middleware |
| Extensible CLI commands | `kick.config.ts` | nest-cli.json | None | None |
| Bundle size | Minimal | Heavy | Minimal | Minimal |

**Differentiators:**
1. **Vite-native HMR** — Only backend framework with built-in Vite hot reload (zero-downtime, preserves connections)
2. **DDD-first** — Generators produce proper domain-driven structure, not flat CRUD
3. **Drizzle-native** — First-class Drizzle ORM with transparent transaction propagation
4. **Zod-native** — Validation schemas double as OpenAPI documentation, no class-transformer/class-validator
5. **Lightweight** — No rxjs, no class-transformer, no class-validator — just TypeScript, Zod, and decorators
6. **Extensible CLI** — `kick.config.ts` lets teams define project-specific commands (db, proto, seed, etc.)

---

## Migration from v0.2.0

| Old (v0.2.0) | New (v0.3.0+) |
|---------------|---------------|
| `@forinda/kickjs` single package | `@kickjs/*` monorepo (5+ packages) |
| Inversify container | Custom lightweight container |
| `KickController` decorator | `@Controller(path)` |
| `KickGet/KickPost/...` | `@Get/@Post/@Put/@Delete/@Patch` |
| `KickMiddleware` class | `@Middleware(handler)` function |
| `createModule(name, { controllers })` | `class XModule implements AppModule` |
| `createKickApp({ app, modules })` | `new Application({ modules, adapters })` |
| `KickRequestContext` (raw req/res) | `RequestContext` (with response helpers) |
| `BaseKickMiddleware` class | `MiddlewareHandler` function type |
| CommonJS output | ESM output |
| tsup build | tsup (packages) + Vite (apps) |
| tsx --watch (full restart) | vite-node --watch (HMR rebuild) |
| No env validation | Zod-based env schemas |
| No code generation | `kick g module <name>` DDD scaffold |
| Static CLI commands only | Extensible via `kick.config.ts` |

---

## Naming & Branding

| Element | Value |
|---------|-------|
| Framework name | **KickJS** |
| npm scope | `@kickjs/*` |
| CLI binary | `kick` |
| Scaffolder | `create-kickjs-app` |
| Config file | `kick.config.ts` |
| GitHub | `github.com/forinda/kick-js` |
| Docs site | TBD |

---

## Versioning

- All packages share the same version number
- Managed via changesets or manual `turbo` version bumping
- Pre-1.0: breaking changes on minor versions
- Post-1.0: semver strictly followed

---

*Last updated: 2026-03-19 (Phase 1 near-complete)*
