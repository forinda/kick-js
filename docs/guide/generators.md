# Generators

The `kick generate` command (alias `kick g`) scaffolds code following KickJS conventions. Generators produce files with proper imports, decorators, and DI registration.

Run `kick g --list` to see all available generators at a glance.

::: tip Default paths are conventions, not rules
Generators emit files into `src/modules/`, `src/middleware/`, `src/plugins/`, `src/adapters/`, and friends because that's the layout `kick new` ships. None of these paths are hard-coded in the framework — adopters can override `modules.dir` in `kick.config.ts`, pass `-o, --out` per invocation, or rearrange entirely. The trees below show the **default layout** that the generators produce out of the box.
:::

::: tip Plugins can ship their own generators
Third-party packages can extend `kick g` via the [CLI plugin contract](./cli-plugins.md). Generators authored with `defineGenerator` and exposed through a `KickCliPlugin.generators[]` show up in `kick g --list` for any project that wires the plugin. See [Plugin Generators](./plugin-generators.md) for the authoring path.
:::

## kick g module

Generate one or more modules. Structure depends on the project `pattern` in `kick.config.ts`.

```bash
kick g module product
kick g module user task project    # generate multiple at once
```

::: tip Pattern determines structure
The `pattern` field in `kick.config.ts` controls what files are generated. You can also override per-invocation with `--pattern`.
:::

### Pattern: `rest` (default — recommended for most apps)

Generates a flat, simple module with a controller that delegates to a service. Every endpoint works out of the box with the in-memory repository.

```bash
kick g module product --pattern rest
```

```
products/
  product.module.ts                 # Module declaration (register + routes)
  product.constants.ts              # Query config (filterable, sortable, searchable) + repo token
  product.controller.ts             # @Controller with full CRUD
  product.service.ts                # @Service wrapping the repository
  product.repository.ts             # Interface + Symbol token
  in-memory-product.repository.ts   # @Repository implementation (in-memory default)
  dtos/
    create-product.dto.ts           # Zod schema for POST
    update-product.dto.ts           # Zod schema for PUT
    product-response.dto.ts         # Response interface
  __tests__/
    product.controller.test.ts
    product.repository.test.ts
```

The controller injects `ProductService`, which handles all CRUD. No use-cases, no domain layer — just clean REST. With a custom repo name (e.g. `--repo postgres`) the implementation file becomes `product-postgres.repository.ts`, a generic stub with TODO markers you wire to your own client.

### Pattern: `minimal`

Generates only a module declaration and a bare controller. Use this as a starting point when you want full control.

```bash
kick g module product --pattern minimal
```

```
products/
  product.module.ts      # Module declaration
  product.controller.ts  # Bare @Controller with a single GET endpoint
```

### Module Flags

| Flag                  | Description                                                       | Default                      |
| --------------------- | ----------------------------------------------------------------- | ---------------------------- |
| `--pattern <type>`    | Override project pattern: `rest`, `minimal`                       | from config or `rest`        |
| `--no-tests`          | Skip test file generation                                         | false                        |
| `--repo <name>`       | Repository name (see [Repository Variants](#repository-variants)) | from config or `inmemory`    |
| `--no-pluralize`      | Use singular names for folders and routes                         | from config or `false`       |
| `--minimal`           | Shorthand for `--pattern minimal`                                 | false                        |
| `--modules-dir <dir>` | Modules directory                                                 | from config or `src/modules` |
| `-f, --force`         | Overwrite existing files without prompting                        | false                        |

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
    repo: { name: 'postgres' },
    pluralize: true,
    schemaDir: 'src/db/schema',
    style: 'define', // 'define' (default) or 'class' — see below
  },
})
```

### Module declaration style

The `modules.style` field controls what `kick g module` and `kick g scaffold` emit for the module declaration:

- **`'define'`** (default) — `defineModule({ name, build: () => ({...}) })` factory form. Mirrors `defineAdapter` / `definePlugin` / `defineContextDecorator`. The orchestrator inserts the factory-call form (`TaskModule()`) into `src/modules/index.ts`.
- **`'class'`** — legacy `class FooModule implements AppModule { ... }` form. The orchestrator inserts the bare class reference (`TaskModule`) into the modules array.

The framework runtime accepts both shapes regardless of this setting — the flag controls codegen output only. `kick rm module` matches both forms, so flipping the flag mid-project doesn't break un-registration.

```bash
# Pin a project to class form (existing-codebase consistency, etc.)
# kick.config.ts → modules: { style: 'class' }
kick g module task
# → src/modules/tasks/task.module.ts emits:
#     export class TaskModule implements AppModule { register() {...} routes() {...} }
# → src/modules/index.ts: [TaskModule]
```

```bash
kick g module user                   # uses rest pattern + postgres repo (from config)
kick g module user --pattern minimal # overrides to minimal structure
kick g module user --repo mongo      # overrides repo, keeps rest pattern
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

The `--repo` flag is name-based. There is exactly one built-in repository — `inmemory` — and any other name scaffolds a generic custom-repository stub.

| Value      | Generated file                   | Description                                                              |
| ---------- | -------------------------------- | ------------------------------------------------------------------------ |
| `inmemory` | `in-memory-{name}.repository.ts` | Working, zero-dependency Map-based store. The default.                   |
| any name   | `{name}-{repo}.repository.ts`    | Generic custom-repository stub with TODO markers — wire your own client. |

**Custom repos** accept any database or ORM name and generate a stub you complete yourself:

```bash
kick g module user --repo postgres    # → postgres-user.repository.ts
kick g module user --repo mongo       # → mongo-user.repository.ts
kick g module user --repo typeorm     # → typeorm-user.repository.ts
```

Custom repositories use a working in-memory implementation as a placeholder with `// TODO: Implement with {repo}` markers, so the generated module compiles and runs immediately — swap the body for your real client when ready.

You can set the default via `kick.config.ts`. The CLI suggests the `{ name }` object form for any non-inmemory repo:

```ts
export default defineConfig({
  modules: {
    // Built-in — working in-memory code
    repo: 'inmemory',

    // Custom — generates stub with TODO markers (preferred object form)
    repo: { name: 'postgres' },
  },
})
```

::: tip Wiring a real database
The only built-in repository is `inmemory`. For persistence, scaffold a generic custom repository (any name, e.g. `postgres`) and wire it to your own client, or install the first-party DB layer with `kick add db` (`@forinda/kickjs-db`, plus `db-pg` / `db-sqlite` / `db-mysql` drivers) and implement the generated stub against it.
:::

### Auto-Registration

When you generate a module, the generator automatically updates `src/modules/index.ts`. `defineModule` factories are called at the registration site — the generator emits `Module()` so bootstrap receives the module instance. If the file does not exist, it creates one:

```ts
import type { AppModuleEntry } from '@forinda/kickjs'
import { ProductModule } from './products'

export const modules: AppModuleEntry[] = [ProductModule()]
```

If `index.ts` already exists, it appends the import and adds the module factory call to the array:

```ts
import type { AppModuleEntry } from '@forinda/kickjs'
import { UserModule } from './users'
import { ProductModule } from './products'

export const modules: AppModuleEntry[] = [UserModule(), ProductModule()]
```

### Generated Module Declaration

The module file (`product.module.ts`) registers the repository binding in the DI container and declares routes. With the default `'define'` style:

```ts
import { defineModule } from '@forinda/kickjs'
import { PRODUCT_REPOSITORY } from './product.constants'
import { InMemoryProductRepository } from './in-memory-product.repository'
import { ProductController } from './product.controller'

export const ProductModule = defineModule({
  name: 'ProductModule',
  build: () => ({
    register(container) {
      container.registerFactory(PRODUCT_REPOSITORY, () =>
        container.resolve(InMemoryProductRepository),
      )
    },
    routes() {
      return {
        path: '/products',
        controller: ProductController, // framework derives the router via buildRoutes()
      }
    },
  }),
})
```

## kick g scaffold

Generate a full CRUD module from field definitions. Unlike `kick g module`, which creates empty DTOs, scaffold generates Zod schemas with concrete fields and a working repository — ready to use immediately. It produces the same flat REST layout as `kick g module` (controller + service + field-aware DTOs + repository), not a layered DDD structure.

```bash
kick g scaffold Post title:string body:text:optional published:boolean:optional
```

### Field Syntax

Each field uses the format `name:type` or `name:type:optional`:

| Type         | TypeScript          | Zod                     | Example                       |
| ------------ | ------------------- | ----------------------- | ----------------------------- |
| `string`     | `string`            | `z.string()`            | `title:string`                |
| `text`       | `string`            | `z.string()`            | `body:text`                   |
| `number`     | `number`            | `z.number()`            | `price:number`                |
| `int`        | `number`            | `z.number().int()`      | `age:int`                     |
| `float`      | `number`            | `z.number()`            | `rating:float`                |
| `boolean`    | `boolean`           | `z.boolean()`           | `active:boolean`              |
| `date`       | `string`            | `z.string().datetime()` | `createdAt:date`              |
| `email`      | `string`            | `z.string().email()`    | `email:email`                 |
| `url`        | `string`            | `z.string().url()`      | `website:url`                 |
| `uuid`       | `string`            | `z.string().uuid()`     | `externalId:uuid`             |
| `json`       | `any`               | `z.any()`               | `metadata:json`               |
| `enum:a,b,c` | `'a' \| 'b' \| 'c'` | `z.enum(['a','b','c'])` | `status:enum:draft,published` |

### Optional Fields

Append `:optional` to make a field optional (shell-safe, no quoting needed):

```bash
kick g scaffold Post title:string body:text:optional published:boolean:optional
```

The `?` syntax also works but requires quoting in bash/zsh because `?` is a shell glob character:

```bash
# These need quotes — ? triggers shell glob expansion without them
kick g scaffold Post title:string "body:text?" "published:boolean?"
kick g scaffold Post title:string "body?:text" "published?:boolean"
```

::: warning Shell glob expansion
`body:text?` without quotes is interpreted by bash/zsh as a file glob pattern — the `?` matches any single character. Always use `:optional` for unquoted usage, or wrap the field in quotes.
:::

### Generated Structure

Scaffold emits the same flat REST module layout as `kick g module`, but with field-aware DTOs and a working repository instead of empty stubs. Inside `posts/`:

| File                           | Description                                             |
| ------------------------------ | ------------------------------------------------------- |
| `post.module.ts`               | Module declaration (register + routes)                  |
| `post.constants.ts`            | Query config (filterable, sortable, searchable) + token |
| `post.controller.ts`           | Full CRUD with typed `Ctx`                              |
| `post.service.ts`              | `@Service` wrapping the repository                      |
| `post.repository.ts`           | Interface + Symbol token                                |
| `in-memory-post.repository.ts` | Working Map-based store (default repo)                  |
| `dtos/create-post.dto.ts`      | Zod schema built from the fields                        |
| `dtos/update-post.dto.ts`      | All fields optional                                     |
| `dtos/post-response.dto.ts`    | Response interface                                      |
| `__tests__/`                   | Controller + repository tests                           |

With a custom repo name (e.g. `--repo postgres`), the implementation file is `post-postgres.repository.ts` — a generic stub with TODO markers.

### Scaffold Flags

| Flag                  | Description               | Default                      |
| --------------------- | ------------------------- | ---------------------------- |
| `--no-tests`          | Skip test file generation | `false`                      |
| `--no-pluralize`      | Use singular names        | from config or `false`       |
| `--repo <name>`       | Repository name           | from config or `inmemory`    |
| `--modules-dir <dir>` | Modules directory         | from config or `src/modules` |

### Example

```bash
kick g scaffold User name:string email:email:optional age:int role:enum:admin,user,guest
```

Generates DTOs like:

```ts
// create-user.dto.ts
import { z } from 'zod'

export const createUserSchema = z.object({
  name: z.string(),
  email: z.string().email().optional(),
  age: z.number().int(),
  role: z.enum(['admin', 'user', 'guest']),
})

export type CreateUserDTO = z.infer<typeof createUserSchema>
```

## kick rm module

Remove one or more modules. Deletes the module directory and unregisters it from `src/modules/index.ts`.

```bash
kick rm module user                  # remove a single module
kick rm module user task project     # remove multiple at once
kick rm module user --force          # skip confirmation prompt
```

The command also supports `kick remove module` as the full form.

## kick g agents

Regenerate the AI-agent documentation trio (`AGENTS.md`, `CLAUDE.md`, `kickjs-skills.md`) from the latest CLI templates. Use this after a KickJS upgrade to pull in new conventions, decorator changes, and gotchas without manually copy-pasting between projects.

```bash
kick g agents                          # Refresh all three (prompts before overwrite)
kick g agents -f                       # Refresh all three, no prompt
kick g agents -f --only skills         # Just kickjs-skills.md
kick g agents -f --only claude         # Just CLAUDE.md
kick g agents -f --only agents         # Just AGENTS.md
kick g agents -f --only both           # AGENTS.md + CLAUDE.md (skip skills)
```

Aliases: `kick g agent-docs`, `kick g ai-docs`.

The generator auto-detects:

- **Project name** from `package.json` `name` (strips `@scope/` prefix).
- **Package manager** from `package.json` `packageManager` (corepack convention).
- **Template** from `kick.config.ts` `pattern` field (defaults to `rest`).

Override any of those with `--name`, `--pm`, `--template`.

| Flag                    | Description                                         | Default               |
| ----------------------- | --------------------------------------------------- | --------------------- |
| `--only <which>`        | `agents` \| `claude` \| `skills` \| `both` \| `all` | `all`                 |
| `--name <name>`         | Project name (overrides `package.json`)             | auto                  |
| `--pm <pm>`             | Package manager (overrides `package.json`)          | auto                  |
| `--template <template>` | `rest` \| `minimal`                                 | from `kick.config.ts` |
| `-f, --force`           | Overwrite without prompting                         | `false`               |

::: tip Local customisations
The three files are overwritten on regeneration. Keep project-specific notes in `AGENTS.local.md` (or any other filename) so they survive `kick g agents -f`.
:::

### What's in each file

- **`AGENTS.md`** — narrative reference: project structure, v4 conventions, decorator patterns, env wiring, common pitfalls. Read first by every AI agent.
- **`CLAUDE.md`** — thin redirect to `AGENTS.md` plus Claude-specific affordances (slash commands, persistent memory, `/loop`, `/schedule`).
- **`kickjs-skills.md`** — short rigid recipes keyed to triggers (`add-module`, `add-adapter`, `write-controller-test`, `bootstrap-export`, `thin-entry-file`, `context-contributor`, `env-wiring-check`, `refresh-agent-docs`, `deny-list`). Designed for agents that read skills from a top-level index (Claude superpowers, Copilot, …).

## Module-Scoped vs Global Generation

::: tip When to use `kick g module` vs standalone generators
**`kick g module <name>`** creates a full flat REST module in one shot — controller, service, DTOs, repository interface + token, repository implementation, and tests. Use this when starting a new feature.

**Standalone generators** (`kick g controller`, `kick g service`, `kick g dto`, `kick g guard`, `kick g middleware`) create a single file. Use these to **add files to an existing module** or to create **app-level** artifacts that don't belong to any module.
:::

### The `--module` flag

Standalone generators support `-m, --module <name>` to place the file inside an existing module's folder structure:

```bash
# Module-scoped — file goes into the module's flat structure
kick g controller auth -m users     # → src/modules/users/auth.controller.ts
kick g service payment -m orders    # → src/modules/orders/payment.service.ts
kick g dto create-user -m users     # → src/modules/users/dtos/create-user.dto.ts
kick g guard admin -m users         # → src/modules/users/guards/admin.guard.ts
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

### Folder mapping

When `--module` is used, each artifact type maps to a folder inside the module's flat layout:

| Generator  | Module folder |
| ---------- | ------------- |
| controller | module root   |
| service    | module root   |
| dto        | `dtos/`       |
| guard      | `guards/`     |
| middleware | `middleware/` |

## Standalone Generators

Each generator creates a single file. Use `-m <module>` to scope it to a module, or `-o <dir>` for a custom directory.

### kick g controller

```bash
kick g controller auth
kick g controller auth -o src/modules/auth
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

### kick g plugin

```bash
kick g plugin analytics                      # → src/plugins/analytics.plugin.ts
kick g plugin feature-flags -o ./src/plugins # explicit output dir
```

Generates a `KickPlugin` factory function with every optional hook (`register`, `modules`, `adapters`, `middleware`, `onReady`, `shutdown`) stubbed out and commented, plus an options interface. Default output: `src/plugins/`.

The generated factory is camelCased from the plugin name — `kick g plugin feature-flags` emits `featureFlagsPlugin` so it can be imported and called inline at bootstrap time:

```ts
import { bootstrap } from '@forinda/kickjs'
import { featureFlagsPlugin } from './plugins/feature-flags.plugin'

export const app = await bootstrap({
  modules,
  plugins: [featureFlagsPlugin({ enabled: true })],
})
```

Plugins are the canonical place to wire DI bindings, contribute modules or adapters, and register middleware without writing a full adapter. See the [plugins guide](./plugins) for the full lifecycle and patterns.

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

### kick g auth-scaffold

Generate a complete auth module with registration, login, logout, and password hashing.

```bash
kick g auth-scaffold                          # JWT strategy (default)
kick g auth-scaffold --strategy session       # Session-based auth
kick g auth-scaffold --out src/modules/auth   # Custom output dir
```

Generated files:

```
src/modules/auth/
  auth.module.ts          # Module registration
  auth.controller.ts      # POST /register, /login, /logout + GET /me
  auth.service.ts         # Business logic with PasswordService
  dto/
    register.dto.ts       # Zod schema for registration
    login.dto.ts          # Zod schema for login
  auth.test.ts            # Test stubs
```

| Flag             | Default            | Description                       |
| ---------------- | ------------------ | --------------------------------- |
| `-s, --strategy` | `jwt`              | Auth strategy: `jwt` or `session` |
| `-o, --out`      | `src/modules/auth` | Output directory                  |

The **JWT** variant generates token-based auth. The **session** variant uses `sessionLogin()` / `sessionLogout()` from `@forinda/kickjs-auth` for cookie-based sessions.

Both variants use `PasswordService` for secure password hashing (scrypt by default, with optional argon2/bcrypt support).

## Common Options

All standalone generators accept:

| Flag                  | Description                  | Default        |
| --------------------- | ---------------------------- | -------------- |
| `-o, --out <dir>`     | Output directory             | Varies by type |
| `-m, --module <name>` | Place inside a module folder | -              |

Names are automatically converted: `kick g module user-profile` produces `UserProfile` (PascalCase) for classes and `user-profile` (kebab-case) for file names. Module names are pluralized for the directory (`user-profiles/`) unless `--no-pluralize` is passed or `pluralize: false` is set in config.
