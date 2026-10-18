# Type Generation

`kick typegen` reads your controllers, decorators and schemas and writes types to a gitignored `.kickjs/` folder. `kick dev` keeps them current. You don't edit or import anything in that folder.

## What gets typed

1. **`container.resolve('UserService')`** returns `UserService` instead of `any`.
2. **`ctx.params`, `ctx.body`, `ctx.query`** are typed per route — including the inferred shape of any Zod schema you wired into the route decorator.
3. **Response types** — inferred from each handler's return type ([return-value handlers](./controllers.md#return-value-handlers); `Reply<S, T>` unwraps; a declared `{ response: schema }` on the route wins). The [typed client](./typed-client.md) uses the same types.
4. **`ctx.qs(config as const)`** narrows `parsed.filters[].field` and `parsed.sort[].field` to the literal whitelist you passed.
5. **`ctx.urlFor('UsersController.show', { id })`** — route names and their params are checked. See [Linking to routes](./controllers.md#linking-to-routes).
6. **`@Value('DATABASE_URL')` and `process.env.DATABASE_URL`** are typed from your project's `src/env.ts` schema — autocomplete on keys, tsc errors on typos, and `Env<'PORT'>` looks up the inferred type.
7. **`dependsOn`** on plugins, adapters and context contributors autocompletes the names in your app; a typo is a compile error instead of a boot error.
8. **Route flags** — `flags.get('rate.limit')` returns the type given to `defineRouteFlag`.

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

`KickRoutes` is global — you don't import it. `Ctx<…>` gives the handler the route's typed body, params and query.

## Running typegen

| Command                 | When it runs                                                                 |
| ----------------------- | ---------------------------------------------------------------------------- |
| `kick typegen`          | One-shot — runs the scan and writes the types                                |
| `kick typegen --watch`  | Re-runs on every source file change (Ctrl-C to exit)                         |
| `kick typegen --fix`    | Also patches module globs to load the classes they miss (see below)          |
| `kick dev`              | Runs once at startup, then re-runs whenever Vite's watcher fires             |
| bare `vite`             | The `kickjs:typegen` vite plugin wires the same watcher + a startup catch-up |
| `kick g module ...`     | Runs after the new files are written                                         |
| `kick g controller ...` | Runs after the new file is written                                           |
| `kick g scaffold ...`   | Runs after the new files are written                                         |
| `kick init`             | Runs once after the project is scaffolded                                    |

You almost never need to run it manually — the dev loop keeps the types up to date.

### Classes no module loads

A decorated class registers when its file is imported. Modules load their files with `import.meta.glob(...)`, so a class in a file no glob matches never registers, and resolving it fails at runtime. Typegen checks every decorated class against its module's globs and warns about the ones left out, with the patterns that would cover them. `kick typegen --fix` adds those patterns to the module's `import.meta.glob(...)` call for you. A module without a glob call is listed for you to edit by hand.

### Watch-mode failure surfacing

A failing pass in watch mode prints one warning (`kick typegen: <source> pass failed (<error>) — types may be stale`) and stays quiet until the message changes or a pass succeeds. A route whose `body`/`query`/`params` schema can't be resolved warns with the controller, method and schema name, and that field is typed `unknown`. A schema declared in the controller file must be exported under its own name (`export const createTaskSchema = ...`); the warning tells you when it isn't.

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

Change the schema and the body type follows on the next typegen run.

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

These produce `body: unknown`. Use a top-level named import to get them typed.

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

KickJS reads the default-exported schema in `src/config/index.ts` (or `src/env.ts`, `src/config/env.ts`, `src/config.ts`). From it, `@Value`, `Env<K>` and `process.env` know your keys and their types.

Build the schema with `fromZod(...)` / `fromValibot(...)` / `fromYup(...)` (from [`@forinda/kickjs-schema`](schema.md)) or the older `defineEnv(...)`, and default-export the schema itself — not the parsed env.

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

loadEnvFromSchema(envSchema) // side effect: registers the schema; read values with getEnv('KEY')
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

With no env schema file, env typing is skipped and `@Value('ANY_STRING')` accepts any key. To opt out explicitly, set `typegen.envFile: false` in `kick.config.ts`.

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
    disable: ['kick/db'], // skip specific plugin typegens (see below)
  },
})
```

| Field             | Default            | What it does                                                                                                                                                                                                                   |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schemaValidator` | `'zod'`            | Which schemas drive `body`/`query`/`params` and env typing. See below. `false` skips schema typing (params still come from URL patterns).                                                                                      |
| `envFile`         | _(candidate list)_ | Path to the project's env schema file. The default sentinel searches `src/config/index.ts`, `src/config/env.ts`, `src/config.ts`, `src/env.ts` in order. Pass an explicit path to pin one; pass `false` to disable env typing. |
| `srcDir`          | `'src'`            | Directory to scan for controllers and decorators.                                                                                                                                                                              |
| `disable`         | `[]`               | Plugin typegen ids to skip. The plugin still loads — only its `generate()` is bypassed. Discover ids with `kick typegen --list`.                                                                                               |

#### `schemaValidator` values

- `'kickjs-schema'` — schemas built with `fromZod` / `fromValibot` / `fromYup`. **Recommended**; `kick new` sets it.
- `'zod'` — plain Zod schemas (the default, for older projects).
- `false` — no schema typing: `body`/`query`/`params` are `unknown` (URL params still typed), env keys untyped.

CLI flags override the config for a single run: `--schema-validator <name>`, `--env-file <path>` (`--env-file false` disables it).

## Disabling specific plugin typegens

Use `typegen.disable` to turn off one plugin's types — for example, to type the database client yourself instead of letting `kick/db` do it:

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

The plugin still loads; only its types are skipped.

### Discover registered ids

<PmCommand exec="kick typegen --list" />

Prints every typegen plugin id and the inputs it watches; disabled ones show `(disabled)`. An unknown id in `typegen.disable` is a warning, not an error. Plugins add their own typegens — see [CLI Plugins](./cli-plugins.md).

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
  (c) Pass --allow-duplicates to namespace the names automatically
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
2. **Remove `rootDir: 'src'`** if present — the generated types live outside `src/`.

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

## Limitations

These are known and deliberate for the current release; some will be lifted in follow-up work:

- **Imperative `ctx.json(...)` handlers infer `response: unknown`.** Response types come from what the handler returns. Use [return-value handlers](./controllers.md#return-value-handlers) or declare `{ response: schema }` on the route for exact types.
- **Joi and JSON Schema are not yet supported.** `typegen.schemaValidator: 'kickjs-schema'` already covers Zod, Valibot, Yup, and Standard Schema v1 — Joi and JSON Schema need a `@forinda/kickjs-schema` adapter first (PRs welcome).
- **Schema references must be bare top-level identifiers.** Member access, function calls, and inline compositions silently fall back to `body: unknown` (see [What the scanner cannot resolve](#what-the-scanner-cannot-resolve-falls-back-to-unknown)).
- **Column-object `@ApiQueryParams` configs (Drizzle-style) are recognised but not narrowed.** Use the string-array form (or `ctx.qs(config as const)`) for typed query field names.
- **A type error can point inside `.kickjs/`** rather than your controller. If it does, check the schema the failing route's decorator references.

## See also

- [Validation](validation.md) — how Zod schemas validate request data at runtime
- [Controllers & Routes](controllers.md) — route decorators and handler patterns
- [Dependency Injection](dependency-injection.md) — `createToken<T>` and typed `container.resolve()`
- [Query Parsing](query-parsing.md) — `ctx.qs()` and `ctx.paginate()` in depth
