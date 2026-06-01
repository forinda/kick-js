# Type Generation

KickJS ships a static type generator that scans your controllers, decorators, and Zod schemas and emits a `.kickjs/types/` directory of `.d.ts` and `.ts` files. The output makes `container.resolve()`, `ctx.params`, `ctx.body`, and `ctx.query` fully typed end-to-end with no manual annotations beyond a single `Ctx<>` helper on each handler.

The pattern is modeled on React Router's `.react-router/types/` directory: a generated, gitignored folder that lives next to your `src/` and is refreshed automatically on `kick dev`.

## What it generates

After running `kick typegen` (or starting `kick dev`), you'll have:

```
.kickjs/
  .gitignore                    # ignores everything inside
  types/
    kick__registry.d.ts         # KickJsRegistry augmentation for container.resolve()
    kick__services.d.ts         # ServiceToken string-literal union
    kick__modules.d.ts          # ModuleToken string-literal union
    kick__plugins.d.ts          # KickJsPluginRegistry augmentation (narrows dependsOn)
    kick__augmentations.d.ts    # defineAugmentation catalogue (docs-only)
    kick__routes.ts             # KickRoutes namespace augmentation (typed Ctx<>)
    kick__env.ts                # KickEnv + NodeJS.ProcessEnv augmentation (when src/env.ts exists)
    kick__assets.d.ts           # KickAssets augmentation (when assetMap is set)
    kick__db.d.ts               # DB model types (when a DB adapter is configured)
    kick__context.d.ts          # ContextKeys augmentation (when context decorators exist)
```

Each file is emitted by its own typegen plugin. There is no barrel
`index.d.ts` — the scaffolded tsconfig pulls the whole directory in via
`include: ['.kickjs/types/**/*.d.ts', '.kickjs/types/**/*.ts']`, so every
`declare module` / `declare global` augmentation applies just by being
present. (Upgrading from an older CLI? The first `kick typegen` run
sweeps the old `index.d.ts` / `registry.d.ts` / `services.d.ts` /
`modules.d.ts` / `plugins.d.ts` / `augmentations.d.ts` files
automatically.)

Four things become type-safe as a result:

1. **`container.resolve('UserService')`** returns `UserService` instead of `any`.
2. **`ctx.params`, `ctx.body`, `ctx.query`** are typed per route — including the inferred shape of any Zod schema you wired into the route decorator.
3. **`ctx.qs(config as const)`** narrows `parsed.filters[].field` and `parsed.sort[].field` to the literal whitelist you passed.
4. **`@Value('DATABASE_URL')` and `process.env.DATABASE_URL`** are typed from your project's `src/env.ts` schema — autocomplete on keys, tsc errors on typos, and `Env<'PORT'>` looks up the inferred type.

## Quick start

KickJS templates already wire everything up. New projects from `kick init` get the right tsconfig include and a HelloController that uses the typed pattern out of the box. If you're adding typegen to an existing project, see [Migration from earlier versions](#migration-from-earlier-versions) below.

A handler looks like this:

```ts
import { Controller, Get, Post, type Ctx } from '@forinda/kickjs'
import { z } from 'zod'

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
})

@Controller()
export class UserController {
  @Get('/:id')
  async getById(ctx: Ctx<KickRoutes.UserController['getById']>) {
    ctx.params.id // typed as string (from the URL pattern)
  }

  @Post('/', { body: createUserSchema })
  async create(ctx: Ctx<KickRoutes.UserController['create']>) {
    ctx.body.email // typed as string (from z.infer<typeof createUserSchema>)
    ctx.body.name // typed as string
    // ctx.body.foo  // ❌ tsc error: property 'foo' does not exist
  }
}
```

`KickRoutes` is a global ambient namespace populated by `kick typegen` — you don't import it. `Ctx<T>` is a thin alias over `RequestContext` that infers the body/params/query from the `RouteShape` you pass in.

## Running typegen

| Command                 | When it runs                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `kick typegen`          | One-shot — runs the scan and writes the types                    |
| `kick typegen --watch`  | Re-runs on every source file change (Ctrl-C to exit)             |
| `kick dev`              | Runs once at startup, then re-runs whenever Vite's watcher fires |
| `kick g module ...`     | Runs after the new files are written                             |
| `kick g controller ...` | Runs after the new file is written                               |
| `kick g scaffold ...`   | Runs after the new files are written                             |
| `kick init`             | Runs once after the project is scaffolded                        |

You almost never need to run it manually — `kick dev` keeps `.kickjs/types/` up to date for you.

## How `params` is typed

URL patterns drive the `params` shape. `:placeholder` segments become `string` properties; routes with no path parameters get an empty `{}` (so accessing a non-existent param is a tsc error).

```ts
@Get('/:userId/posts/:postId')
async getPost(ctx: Ctx<KickRoutes.PostController['getPost']>) {
  ctx.params.userId // string
  ctx.params.postId // string
  // ctx.params.commentId // ❌ tsc error
}

@Get('/')
async list(ctx: Ctx<KickRoutes.PostController['list']>) {
  ctx.params // {}
  // ctx.params.id // ❌ tsc error
}
```

If you also pass a `params` Zod schema in the route decorator, the schema's inferred type wins over the URL-pattern shape:

```ts
const idParams = z.object({ id: z.string().uuid() })

@Get('/:id', { params: idParams })
async getById(ctx: Ctx<KickRoutes.PostController['getById']>) {
  ctx.params.id // typed as string (from Zod, not just URL pattern)
}
```

## How `body` is typed

Schemas referenced in route decorators are picked up automatically:

```ts
import { createPostSchema } from './dtos/create-post.dto'

@Post('/', { body: createPostSchema })
async create(ctx: Ctx<KickRoutes.PostController['create']>) {
  ctx.body // z.infer<typeof createPostSchema>
}
```

The scanner resolves the identifier through your top-level imports (`import { createPostSchema } from '...'`) and emits a hoisted `import type` at the top of `.kickjs/types/routes.ts`. The body type is then `import('zod').infer<typeof <alias>>`, so any change to your Zod schema is reflected immediately the next time typegen runs.

### What the scanner can resolve

- ✅ Named imports: `import { schema } from './dto'` then `body: schema`
- ✅ Default imports: `import schema from './dto'` then `body: schema`
- ✅ Namespace imports: `import * as Schemas from './dto'` then `body: Schemas` (the whole module is referenced)
- ✅ Same-file `const`: `const schema = z.object({...})` declared anywhere in the file

### What the scanner cannot resolve (falls back to `unknown`)

- ❌ Member access: `body: Schemas.create`
- ❌ Function calls: `body: makeSchema(...)`
- ❌ Inline composition: `body: { ...other, refined: true }`
- ❌ Cross-file aliases that don't reach a top-level identifier in the controller file

These cases silently produce `body: unknown` rather than emitting a broken import. Refactor to a top-level named import if you want them typed.

## How `query` is typed

Query types come from two sources, in priority order:

### 1. `@ApiQueryParams` decorator

```ts
@Get('/')
@ApiQueryParams({
  filterable: ['status', 'priority'],
  sortable: ['createdAt', 'name'],
  searchable: ['title', 'description'],
})
async list(ctx: Ctx<KickRoutes.TaskController['list']>) {
  ctx.query.sort // 'createdAt' | '-createdAt' | 'name' | '-name'
  ctx.query.filter // string | string[]
  ctx.query.q // string | undefined
  ctx.query.page // string | undefined
  ctx.query.limit // string | undefined
}
```

The whitelist arrays are extracted from inline literals and same-file `const` declarations. Column-object configs (e.g. Drizzle's `{ columns, sortable, searchColumns }`) are recognised but not yet narrowed — they emit `query: unknown` for now.

### 2. Generic `ctx.qs<TConfig>()`

This works without typegen — it's pure TypeScript inference. Pass the config inline with `as const`:

```ts
async list(ctx: Ctx<KickRoutes.TaskController['list']>) {
  const parsed = ctx.qs({
    filterable: ['status', 'priority'],
    sortable: ['createdAt'],
  } as const)

  parsed.filters[0]?.field // 'status' | 'priority'
  parsed.sort[0]?.field    // 'createdAt'
}
```

Without `as const`, the field unions widen to `string` — that's the documented escape hatch when you don't want literal narrowing.

## How env vars are typed

KickJS scans `src/config/index.ts` (or `src/env.ts`, `src/config/env.ts`, `src/config.ts`) for a default-exported schema. When found, the generator emits `.kickjs/types/kick__env.ts` augmenting two globals:

- **`KickEnv`** — an interface holding the inferred shape of your env schema. This drives `@Value` and the `Env<K>` type helper.
- **`NodeJS.ProcessEnv`** — narrowed so known keys exist as `string` (the raw pre-coercion form).

The accepted schema-construction calls are `defineEnv(...)` (legacy Zod scaffold) and `fromZod(...)` / `fromValibot(...)` / `fromYup(...)` (the [`@forinda/kickjs-schema`](schema.md) adapters). A file that constructs one of those AND default-exports the schema is detected; a file that default-exports the _parsed_ env (e.g. `export default loadEnvFromSchema(schema)`) is explicitly rejected so the generator doesn't run the env value type through `InferSchemaOutput`.

### Authoring `src/config/index.ts`

`kick new --schema {zod,valibot,yup}` scaffolds this file for you with the right wrap. To add a key, extend the schema:

```ts
// src/config/index.ts — Zod (recommended default)
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

export const env = loadEnvFromSchema(envSchema)
export default envSchema
```

The legacy `defineEnv((base) => base.extend({…}))` form is still detected — pre-`@forinda/kickjs-schema` projects keep working without migration. See [Configuration](configuration.md#defining-an-environment-schema) for the full set of Zod / Valibot / Yup templates.

### Using typed env in services

Once typegen has run, `@Value` is constrained to known keys and `Env<K>` resolves to the schema-inferred type for that key:

```ts
import { Service, Value, type Env } from '@forinda/kickjs'

@Service()
export class DatabaseService {
  @Value('DATABASE_URL') private readonly url!: Env<'DATABASE_URL'> // string
  @Value('PORT') private readonly port!: Env<'PORT'> // number (Zod coerced)

  // @Value('NOPE') readonly bad!: string  // ❌ tsc error: '"NOPE"' is not assignable to 'never'
}
```

`process.env` is also typed for known keys:

```ts
const url: string = process.env.DATABASE_URL // ✅ string, not string | undefined
```

Note that `process.env.DATABASE_URL` returns the _raw_ string from the OS environment — Zod's coercions and defaults are applied by `@Value` and `ConfigService`, not by Node's process.env. Use the decorator (or `ConfigService.get()`) when you want the schema-coerced value (`PORT: number`); use `process.env` when you specifically want the raw string.

### When the env file is missing

If `src/env.ts` doesn't exist (or doesn't have `defineEnv` + `export default`), typegen silently skips the env augmentation. `KickEnv` stays empty, and `@Value('ANY_STRING')` keeps accepting any literal — back-compat for legacy projects. To opt out explicitly, set `typegen.envFile: false` in `kick.config.ts`.

### Configuring the env file path

Default: `'src/env.ts'`. Override in `kick.config.ts`:

```ts
export default defineConfig({
  typegen: {
    envFile: 'src/config/env.ts', // custom path
    // envFile: false,            // disable env typing entirely
  },
})
```

Or via CLI: `kick typegen --env-file src/config/env.ts`.

## Configuration

`kick.config.ts` controls typegen via the `typegen` block:

```ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  typegen: {
    schemaValidator: 'kickjs-schema', // 'zod' | 'kickjs-schema' | false (default: 'zod')
    envFile: 'src/config/index.ts', // string | false (default: candidate search)
    srcDir: 'src', // optional override
    outDir: '.kickjs/types', // optional override
    disable: ['kick/db'], // skip specific plugin typegens (see below)
  },
})
```

| Field             | Default            | What it does                                                                                                                                                                                                                   |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schemaValidator` | `'zod'`            | Drives `body`/`query`/`params` type inference and the `KickEnv` codegen. See the table below for what each value emits. Set to `false` to skip schema-driven typing entirely (params still come from URL patterns).            |
| `envFile`         | _(candidate list)_ | Path to the project's env schema file. The default sentinel searches `src/config/index.ts`, `src/config/env.ts`, `src/config.ts`, `src/env.ts` in order. Pass an explicit path to pin one; pass `false` to disable env typing. |
| `srcDir`          | `'src'`            | Directory to scan for controllers and decorators.                                                                                                                                                                              |
| `outDir`          | `'.kickjs/types'`  | Where to write generated files.                                                                                                                                                                                                |
| `disable`         | `[]`               | Plugin typegen ids to skip. The plugin still loads — only its `generate()` is bypassed. Discover ids with `kick typegen --list`.                                                                                               |

#### `schemaValidator` values

| Value             | Env codegen                                                            | Body/query/params codegen                              | Use when                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `'zod'`           | `import('zod').infer<typeof _envSchema>`                               | `import('zod').infer<typeof Schema>`                   | Legacy / Zod-only projects (default for back-compat).                                                                               |
| `'kickjs-schema'` | `InferSchemaOutput<typeof _envSchema>` flattened through a mapped type | `InferSchemaOutput<typeof Schema>`                     | Projects using `fromZod` / `fromValibot` / `fromYup` schemas. **Recommended for new projects.** `kick new` sets this automatically. |
| `false`           | (skipped — no `KickEnv` augmentation)                                  | `unknown` for body/query/params (URL params unchanged) | Adopters who want hand-rolled typing or are validator-agnostic.                                                                     |

CLI flags override the config for a single run: `--schema-validator <name>`, `--env-file <path>` (`--env-file false` disables it).

## Disabling specific plugin typegens

Use `typegen.disable` when an adopter wants to keep the legacy pass and most plugin typegens but opt out of one — for example, to hand-write `KickDbRegister` instead of letting the `kick/db` plugin emit `kick__db.d.ts`:

```ts
// kick.config.ts
export default defineConfig({
  typegen: { disable: ['kick/db'] },
})
```

```ts
// src/db/register.ts (hand-written, owns the augmentation)
import type { dbClient } from './client'

declare module '@forinda/kickjs-db' {
  interface KickDbRegister {
    db: typeof dbClient
  }
}
```

The plugin still loads (so merge-time conflict detection still runs); only its `generate()` invocation is skipped. Adopters disabling `kick/db` typically import their `register.ts` for the side-effect declaration.

### Discover registered ids

```bash
kick typegen --list
```

Prints every typegen plugin id with its watched inputs:

```
  Registered typegen plugins:

    kick/db      inputs: src/db/schema.ts, src/db/schema/**/*.ts
    kick/assets  inputs: kick.config.ts, kick.config.js, kick.config.mjs
```

Disabled ids show `(disabled)` next to the entry. Unknown ids in `typegen.disable` (typos, removed plugins) surface as a startup warning rather than a hard error so the dev loop stays alive while you fix the config.

See [CLI Plugins](./cli-plugins.md) for the full plugin contract — every typegen above ships as a `KickCliPlugin.typegens[]` entry, including the built-ins.

## Token collisions

Two classes with the same name in different files (e.g. `class UserService` in both `users/` and `admin/`) are a collision. By default `kick typegen` fails fast:

```
kick typegen: token collision detected

  2 classes named 'UserService':
    - src/modules/users/user.service.ts
    - src/modules/admin/user.service.ts

Resolutions:
  (a) Rename one of the classes
  (b) Use createToken<T>('namespaced/Name') and import the token explicitly
  (c) Pass --allow-duplicates to namespace the registry keys automatically
```

`kick dev` enables `--allow-duplicates` internally so an in-progress rename never blocks the dev server — colliding entries get auto-namespaced (e.g. `'modules/users/UserService'`) until you resolve them.

For non-class tokens (config bags, factory results, environment values), use `createToken<T>(name)` instead of raw strings — it returns a unique frozen object so collisions are impossible by construction:

```ts
import { createToken } from '@forinda/kickjs'

export const DATABASE_URL = createToken<string>('config.database.url')

container.registerInstance(DATABASE_URL, process.env.DATABASE_URL!)
const url = container.resolve(DATABASE_URL) // typed as string
```

See [Dependency Injection](dependency-injection.md) for the full DI hardening story.

## Migration from earlier versions

If you have an existing KickJS project that pre-dates the typegen, two changes are needed in your `tsconfig.json`:

1. Add `".kickjs/types/**/*.d.ts"` and `".kickjs/types/**/*.ts"` to `include`.
2. **Remove `rootDir: 'src'`** if present — the generated `routes.ts` lives outside `src/` and tsc refuses to include files outside the rootDir.

```json
{
  "compilerOptions": {
    // remove this line if present:
    // "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src", ".kickjs/types/**/*.d.ts", ".kickjs/types/**/*.ts"]
}
```

Then add `.kickjs/` to your `.gitignore` and run `kick typegen` once to generate the initial files. Your existing handlers continue to work with `RequestContext` — `Ctx<T>` is opt-in per handler.

## Why is `routes.ts` a `.ts` file and the others are `.d.ts`?

TypeScript silently degrades top-level `import('...')` calls inside `.d.ts` files to `unknown` when `moduleResolution` is `bundler`. The generator emits `routes.ts` as a regular TypeScript file (declarations only — zero runtime cost) so the schema imports actually resolve. The other generated files are pure declarations and stay as `.d.ts`.

This is why your tsconfig include needs to match both extensions.

## Plugin & adapter registry

`kick typegen` walks your `src/` for `defineAdapter({ name: '...' })` and `definePlugin({ name: '...' })` calls and writes the discovered names into `.kickjs/types/plugins.d.ts` as a `KickJsPluginRegistry` augmentation. Class-style declarations (`class X implements AppAdapter`) are _not_ scanned — those are the v3 pattern and were removed in v4.

```ts
// .kickjs/types/plugins.d.ts (generated)
declare module '@forinda/kickjs' {
  interface KickJsPluginRegistry {
    TenantAdapter: 'adapter'
    AuthAdapter: 'adapter'
    FlagsPlugin: 'plugin'
  }
}
```

Once the registry is populated, the `dependsOn` field on plugins and adapters narrows from `readonly string[]` to `readonly (keyof KickJsPluginRegistry)[]`:

```ts
export const AuthAdapter = defineAdapter({
  name: 'AuthAdapter',
  dependsOn: ['TenantAdapter'], // ✓ — autocompletes from the registry
  // dependsOn: ['Tennant'],      // ✗ — TS error: not assignable to keyof KickJsPluginRegistry
  build: (config) => ({
    /* ... */
  }),
})
```

Two payoffs:

- **Typo-killing.** Misspelled `dependsOn` references become compile errors instead of boot-time `MissingMountDepError`.
- **Discoverability.** IDE autocomplete inside `dependsOn: [...]` lists every plugin/adapter name in scope.

When the registry is empty (fresh project, never ran `kick typegen`), `keyof KickJsPluginRegistry` resolves to `never` and the runtime falls back to `string` so existing code keeps compiling. Run `kick typegen` once and the narrowing kicks in.

## Context keys (`dependsOn` on contributors)

`kick typegen` also walks your `src/` for `defineContextDecorator({ key: '...' })` and `defineHttpContextDecorator({ key: '...' })` calls (including the curried `.withParams<T>()({ key: '...' })` form) and writes every discovered key into `.kickjs/types/kick__context.d.ts` as a `ContextKeys` augmentation:

```ts
// .kickjs/types/kick__context.d.ts (generated)
declare module '@forinda/kickjs' {
  interface ContextKeys {
    tenant: true
    session: true
  }
}
```

This is what makes a Context Contributor's `dependsOn` typo-checked **without you hand-maintaining a registry** — and without forcing a value type into `ContextMeta`. `dependsOn` narrows to the union of `keyof ContextMeta` (keys with a value type) and `keyof ContextKeys` (every contributor key), so:

```ts
defineHttpContextDecorator({
  key: 'project',
  dependsOn: ['tenant'], // ✓ — autocompletes from discovered keys
  // dependsOn: ['tenent'], // ✗ — TS error: "Did you mean 'tenant'?"
  resolve: (ctx) => loadProject(ctx),
})
```

`ContextMeta` still drives the value type of `ctx.get('tenant')`; `ContextKeys` only records that the key exists. Scaffold a contributor (and its `ContextMeta` stub) with [`kick g contributor`](./context-decorators.md). Empty project → no `kick__context.d.ts` emitted and `dependsOn` falls back to `string[]`.

## Augmentation catalogue

> **Deprecated.** `defineAugmentation` does nothing at runtime or at the type level — the `declare module '@forinda/kickjs' { … }` block alone gives you the augmentation, and the catalogue it feeds is documentation-only. Prefer a plain `declare module` block with a JSDoc comment on your own interface. `defineAugmentation` and the `kick/augmentations` typegen plugin will be removed in a future major.

Plugins advertise augmentable interfaces by calling `defineAugmentation('Name', meta)` — a runtime no-op that exists purely for `kick typegen` to discover:

```ts
import { defineAugmentation } from '@forinda/kickjs'

export interface FeatureFlags {} // augmentable

defineAugmentation('FeatureFlags', {
  description: 'Flags consumed by FlagsPlugin',
  example: '{ beta: boolean; rolloutPercentage: number }',
})
```

Each call surfaces in `.kickjs/types/augmentations.d.ts` as a documentation-only block with the description, an example snippet, and a `@see` link back to the source file. Adopters jumping into one file see every augmentable interface their plugins offer rather than grepping each plugin's README.

## Limitations

These are known and deliberate for the current release; some will be lifted in follow-up work:

- **Response types are not generated.** Handler return types are not statically inferable without a heavyweight TypeScript compiler-API integration. There's no `response` typing today.
- **Joi and JSON Schema are not yet supported.** `typegen.schemaValidator: 'kickjs-schema'` already covers Zod, Valibot, Yup, and Standard Schema v1 — Joi and JSON Schema need a `@forinda/kickjs-schema` adapter first (PRs welcome).
- **Schema references must be bare top-level identifiers.** Member access, function calls, and inline compositions silently fall back to `body: unknown` (see [What the scanner cannot resolve](#what-the-scanner-cannot-resolve-falls-back-to-unknown)).
- **Column-object `@ApiQueryParams` configs (Drizzle-style) are recognised but not narrowed.** Use the string-array form (or `ctx.qs(config as const)`) for typed query field names.
- **Errors in generated `routes.ts` point at the generated file**, not your controller. The line numbers and identifiers are accurate, but the file path is `.kickjs/types/routes.ts` rather than your source. If you see a tsc error there, look at the schema that the failing route's decorator references.

## See also

- [Validation](validation.md) — how Zod schemas validate request data at runtime
- [Controllers & Routes](controllers.md) — route decorators and handler patterns
- [Dependency Injection](dependency-injection.md) — `createToken<T>`, `KickJsRegistry`, and the four-layer DI hardening
- [Query Parsing](query-parsing.md) — `ctx.qs()` and `ctx.paginate()` in depth
