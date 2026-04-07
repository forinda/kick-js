# Generators

The `kick generate` command (alias `kick g`) scaffolds code following KickJS conventions. Generators produce files with proper imports, decorators, and DI registration.

Run `kick g --list` to see all available generators at a glance.

## kick g module

Generate one or more modules. Structure depends on the project `pattern` in `kick.config.ts`.

```bash
kick g module product
kick g module user task project    # generate multiple at once
```

::: tip Pattern determines structure
The `pattern` field in `kick.config.ts` controls what files are generated. You can also override per-invocation with `--pattern`.
:::

### Pattern: `rest` (recommended for most apps)

Generates a flat, simple module with a controller that delegates to a service. Every endpoint works out of the box with the in-memory repository.

```bash
kick g module product --pattern rest
```

```
products/
  index.ts                          # Module class (register + routes)
  product.constants.ts              # Query config (filterable, sortable, searchable)
  product.controller.ts             # @Controller with full CRUD
  product.service.ts                # @Service wrapping the repository
  product.repository.ts             # Interface + Symbol token
  in-memory-product.repository.ts   # @Repository implementation
  dtos/
    create-product.dto.ts           # Zod schema for POST
    update-product.dto.ts           # Zod schema for PUT
    product-response.dto.ts         # Response interface
  __tests__/
    product.controller.test.ts
    product.repository.test.ts
```

The controller injects `ProductService`, which handles all CRUD. No use-cases, no domain layer — just clean REST.

### Pattern: `ddd` (full Domain-Driven Design)

Generates a layered DDD module with presentation, application, domain, and infrastructure layers. Use this for complex domains where you need entities, value objects, and use-case orchestration.

```bash
kick g module product --pattern ddd
```

```
products/
  index.ts                                          # Module class
  constants.ts                                      # DI tokens and query config
  presentation/
    product.controller.ts                           # @Controller injecting use-cases
  application/
    dtos/
      create-product.dto.ts                         # Zod schemas
      update-product.dto.ts
      product-response.dto.ts
    use-cases/
      create-product.use-case.ts                    # @Service use-case classes
      get-product.use-case.ts
      list-products.use-case.ts
      update-product.use-case.ts
      delete-product.use-case.ts
  domain/
    entities/product.entity.ts                      # Entity with factory methods
    value-objects/product-id.vo.ts                   # Typed ID value object
    repositories/product.repository.ts              # Interface + Symbol token
    services/product-domain.service.ts              # Domain logic
  infrastructure/
    repositories/in-memory-product.repository.ts    # @Repository implementation
  __tests__/
    product.controller.test.ts
    product.repository.test.ts
```

### Pattern: `minimal`

Generates only a module index and a bare controller. Use this as a starting point when you want full control.

```bash
kick g module product --pattern minimal
```

```
products/
  index.ts                # Module class
  product.controller.ts   # Bare @Controller with a single GET endpoint
```

### Pattern: `cqrs`

Generates a CQRS module that separates read (queries) and write (commands) operations. Events are emitted after state changes and can be handled via WebSocket broadcasts, queue jobs, or ETL pipelines.

```bash
kick g module product --pattern cqrs
```

```
products/
  index.ts                              # Module class
  product.controller.ts                 # REST controller dispatching commands/queries
  product.constants.ts                  # Query config
  commands/
    create-product.command.ts           # Command + handler (emits events)
    update-product.command.ts
    delete-product.command.ts
  queries/
    get-product.query.ts                # Query handler
    list-products.query.ts
  events/
    product.events.ts                   # Typed event emitter (created/updated/deleted)
    on-product-change.handler.ts        # Event handler (WS broadcast, queue dispatch, ETL)
  dtos/
    create-product.dto.ts
    update-product.dto.ts
    product-response.dto.ts
  product.repository.ts                 # Interface + Symbol token
  in-memory-product.repository.ts       # @Repository implementation
  __tests__/
    product.controller.test.ts
    product.repository.test.ts
```

The event handler includes commented-out integration points for:
- **WebSocket** — broadcast changes to connected clients in real-time via `@forinda/kickjs-ws`
- **Queue** — dispatch async jobs for background processing via `@forinda/kickjs-queue`
- **ETL** — transform and load data to external systems

### Module Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--pattern <type>` | Override project pattern: `rest`, `ddd`, `cqrs`, `minimal` | from config or `ddd` |
| `--no-entity` | Skip entity and value object generation (DDD only) | false |
| `--no-tests` | Skip test file generation | false |
| `--repo <type>` | Repository implementation (see [Repository Variants](#repository-variants)) | from config or `inmemory` |
| `--no-pluralize` | Use singular names for folders and routes | from config or `false` |
| `--minimal` | Shorthand for `--pattern minimal` | false |
| `--modules-dir <dir>` | Modules directory | from config or `src/modules` |
| `-f, --force` | Overwrite existing files without prompting | false |

### Pluralization

By default, module names are pluralized: `kick g module user` creates `src/modules/users/` with route `/users`.

Disable pluralization per-command or globally:

```bash
# Per-command
kick g module user --no-pluralize    # → src/modules/user/, route /user

# Via config (applies to all generators)
export default defineConfig({
  pluralize: false,
})
```

The `--no-pluralize` flag always wins over the config value.

### Config-Aware Defaults

The generator reads `kick.config.ts` for defaults. Module-specific settings live under the `modules` key:

```ts
// kick.config.ts
export default defineConfig({
  pattern: 'rest',
  modules: {
    dir: 'src/modules',
    repo: 'drizzle',
    pluralize: true,
    schemaDir: 'src/db/schema',
  },
})
```

```bash
kick g module user                   # uses rest pattern + drizzle (from config)
kick g module user --pattern ddd     # overrides to DDD structure
kick g module user --repo prisma     # overrides repo, keeps rest pattern
kick g module user --no-pluralize    # overrides pluralization
```

::: tip Backward compatibility
Top-level `modulesDir`, `defaultRepo`, `pluralize`, and `schemaDir` are still supported but deprecated. Prefer the `modules` block.
:::

### Overwrite Protection

If you run the generator for a module that already exists, the CLI prompts for each file:

```
  File already exists: index.ts
  Overwrite? (y/n/a = yes/no/all)
```

- **y** — overwrite this file
- **n** — skip this file
- **a** — overwrite all remaining files without prompting

Use `--force` to skip all prompts and overwrite everything.

### Repository Variants

The `--repo` flag generates a different infrastructure implementation:

**Built-in types** generate fully working repository code:

| Value | Generated file | Description |
|-------|---------------|-------------|
| `inmemory` | `in-memory-{name}.repository.ts` | Working Map-based store for prototyping |
| `drizzle` | `drizzle-{name}.repository.ts` | Working Drizzle ORM queries with `DRIZZLE_DB` injection |
| `prisma` | `prisma-{name}.repository.ts` | Working Prisma Client queries with `PRISMA_CLIENT` injection |

**Custom types** accept any ORM name and generate a stub with TODO markers:

```bash
kick g module user --repo typeorm     # → typeorm-user.repository.ts
kick g module user --repo mongoose    # → mongoose-user.repository.ts
kick g module user --repo mikro-orm   # → mikro-orm-user.repository.ts
```

Custom repositories use a working in-memory implementation as a placeholder with `// TODO: Implement with {orm}` markers, so the generated module compiles and runs immediately.

You can set the default via `kick.config.ts`:

```ts
export default defineConfig({
  modules: {
    // Built-in (string) — generates working code
    repo: 'prisma',

    // Custom (object) — generates stub with TODO markers
    repo: { name: 'typeorm' },
  },
})
```

### Auto-Registration

When you generate a module, the generator automatically updates `src/modules/index.ts`. If the file does not exist, it creates one:

```ts
import type { AppModuleClass } from '@forinda/kickjs'
import { ProductModule } from './products'

export const modules: AppModuleClass[] = [ProductModule]
```

If `index.ts` already exists, it appends the import and adds the module to the array:

```ts
import type { AppModuleClass } from '@forinda/kickjs'
import { UserModule } from './users'
import { ProductModule } from './products'

export const modules: AppModuleClass[] = [UserModule, ProductModule]
```

### Generated Module Index

The module `index.ts` registers the repository binding in the DI container and declares routes:

```ts
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { PRODUCT_REPOSITORY } from './domain/repositories/product.repository'
import { InMemoryProductRepository } from './infrastructure/repositories/in-memory-product.repository'
import { ProductController } from './presentation/product.controller'

export class ProductModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(PRODUCT_REPOSITORY, () =>
      container.resolve(InMemoryProductRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/products',
      router: buildRoutes(ProductController),
      controller: ProductController,
    }
  }
}
```

## kick rm module

Remove one or more modules. Deletes the module directory and unregisters it from `src/modules/index.ts`.

```bash
kick rm module user                  # remove a single module
kick rm module user task project     # remove multiple at once
kick rm module user --force          # skip confirmation prompt
```

The command also supports `kick remove module` as the full form.

## Module-Scoped vs Global Generation

::: tip When to use `kick g module` vs standalone generators
**`kick g module <name>`** creates a full DDD module with all layers in one shot — controller, DTOs, use-cases, repository interface, implementation, domain service, entity, value objects, and tests. Use this when starting a new feature.

**Standalone generators** (`kick g controller`, `kick g service`, `kick g dto`, `kick g guard`, `kick g middleware`) create a single file. Use these to **add files to an existing module** or to create **app-level** artifacts that don't belong to any module.
:::

### The `--module` flag

Standalone generators support `-m, --module <name>` to place the file inside an existing module's DDD folder structure:

```bash
# Module-scoped — file goes into the module's DDD structure
kick g controller auth -m users     # → src/modules/users/presentation/auth.controller.ts
kick g service payment -m orders    # → src/modules/orders/domain/services/payment.service.ts
kick g dto create-user -m users     # → src/modules/users/application/dtos/create-user.dto.ts
kick g guard admin -m users         # → src/modules/users/presentation/guards/admin.guard.ts
kick g middleware cache -m products # → src/modules/products/middleware/cache.middleware.ts

# Global / app-level — file goes to the standalone default directory
kick g controller health            # → src/controllers/health.controller.ts
kick g middleware logger             # → src/middleware/logger.middleware.ts
kick g guard rate-limit              # → src/guards/rate-limit.guard.ts
```

The `--module` flag respects `modules.dir` from `kick.config.ts`. If you also pass `-o, --out <dir>`, the explicit output directory always wins.

::: warning Adapters are always app-level
Adapters (`kick g adapter`) do not support `--module` because they configure app-wide lifecycle hooks and are not scoped to a single module.
:::

### Folder mapping by pattern

When `--module` is used, each artifact type maps to a folder based on the project pattern:

**DDD pattern:**

| Generator | Module folder |
|-----------|--------------|
| controller | `presentation/` |
| service | `domain/services/` |
| dto | `application/dtos/` |
| guard | `presentation/guards/` |
| middleware | `middleware/` |

**REST / GraphQL / Minimal patterns (flat):**

| Generator | Module folder |
|-----------|--------------|
| controller | module root |
| service | module root |
| dto | `dtos/` |
| guard | `guards/` |
| middleware | `middleware/` |

## Standalone Generators

Each generator creates a single file. Use `-m <module>` to scope it to a module, or `-o <dir>` for a custom directory.

### kick g controller

```bash
kick g controller auth
kick g controller auth -o src/modules/auth/presentation
```

Generates a `@Controller()` class with basic `@Get('/')` route. Default output: `src/controllers/`.

### kick g service

```bash
kick g service payment
```

Generates a `@Service()` class. Default output: `src/services/`.

### kick g middleware

```bash
kick g middleware logger
```

Generates an Express middleware function. Default output: `src/middleware/`.

### kick g guard

```bash
kick g guard admin
```

Generates a route guard function. Default output: `src/guards/`.

### kick g adapter

```bash
kick g adapter websocket
```

Generates an `AppAdapter` class with all lifecycle hooks stubbed out. Default output: `src/adapters/`.

### kick g dto

```bash
kick g dto create-user
```

Generates a Zod schema with inferred TypeScript type. Default output: `src/dtos/`.

### kick g test

```bash
kick g test user-service                  # → src/__tests__/user-service.test.ts
kick g test user-service -m users         # → src/modules/users/__tests__/user-service.test.ts
```

Generates a Vitest test scaffold with `Container.reset()` setup. Default output: `src/__tests__/`.

## Common Options

All standalone generators accept:

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --out <dir>` | Output directory | Varies by type |
| `-m, --module <name>` | Place inside a module folder | - |

Names are automatically converted: `kick g module user-profile` produces `UserProfile` (PascalCase) for classes and `user-profile` (kebab-case) for file names. Module names are pluralized for the directory (`user-profiles/`) unless `--no-pluralize` is passed or `pluralize: false` is set in config.
