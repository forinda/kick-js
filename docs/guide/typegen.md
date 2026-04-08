# Type Generation

KickJS ships a static type generator that scans your controllers, decorators, and Zod schemas and emits a `.kickjs/types/` directory of `.d.ts` and `.ts` files. The output makes `container.resolve()`, `ctx.params`, `ctx.body`, and `ctx.query` fully typed end-to-end with no manual annotations beyond a single `Ctx<>` helper on each handler.

The pattern is modeled on React Router's `.react-router/types/` directory: a generated, gitignored folder that lives next to your `src/` and is refreshed automatically on `kick dev`.

## What it generates

After running `kick typegen` (or starting `kick dev`), you'll have:

```
.kickjs/
  .gitignore                    # ignores everything inside
  types/
    index.d.ts                  # barrel re-exporting the unions below
    registry.d.ts               # KickJsRegistry augmentation for container.resolve()
    services.d.ts               # ServiceToken string-literal union
    modules.d.ts                # ModuleToken string-literal union
    routes.ts                   # KickRoutes namespace augmentation (typed Ctx<>)
```

Three things become type-safe as a result:

1. **`container.resolve('UserService')`** returns `UserService` instead of `any`.
2. **`ctx.params`, `ctx.body`, `ctx.query`** are typed per route — including the inferred shape of any Zod schema you wired into the route decorator.
3. **`ctx.qs(config as const)`** narrows `parsed.filters[].field` and `parsed.sort[].field` to the literal whitelist you passed.

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

## Configuration

`kick.config.ts` controls typegen via the `typegen` block:

```ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  typegen: {
    schemaValidator: 'zod', // 'zod' | false (default: 'zod')
    srcDir: 'src', // optional override
    outDir: '.kickjs/types', // optional override
  },
})
```

| Field             | Default           | What it does                                                                                                                               |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `schemaValidator` | `'zod'`           | Drives `body`/`query`/`params` type inference. Set to `false` to skip schema-driven typing entirely (params still come from URL patterns). |
| `srcDir`          | `'src'`           | Directory to scan for controllers and decorators.                                                                                          |
| `outDir`          | `'.kickjs/types'` | Where to write generated files.                                                                                                            |

The CLI flag `--schema-validator <name>` overrides the config for a single run.

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

## Limitations

These are known and deliberate for the current release; some will be lifted in follow-up work:

- **Response types are not generated.** Handler return types are not statically inferable without a heavyweight TypeScript compiler-API integration. There's no `response` typing today.
- **Joi, Yup, and JSON Schema are not yet supported.** The `typegen.schemaValidator` config slot is designed to accept other validators in the future, but only Zod ships built-in for now.
- **Schema references must be bare top-level identifiers.** Member access, function calls, and inline compositions silently fall back to `body: unknown` (see [What the scanner cannot resolve](#what-the-scanner-cannot-resolve-falls-back-to-unknown)).
- **Column-object `@ApiQueryParams` configs (Drizzle-style) are recognised but not narrowed.** Use the string-array form (or `ctx.qs(config as const)`) for typed query field names.
- **Errors in generated `routes.ts` point at the generated file**, not your controller. The line numbers and identifiers are accurate, but the file path is `.kickjs/types/routes.ts` rather than your source. If you see a tsc error there, look at the schema that the failing route's decorator references.

## See also

- [Validation](validation.md) — how Zod schemas validate request data at runtime
- [Controllers & Routes](controllers.md) — route decorators and handler patterns
- [Dependency Injection](dependency-injection.md) — `createToken<T>`, `KickJsRegistry`, and the four-layer DI hardening
- [Query Parsing](query-parsing.md) — `ctx.qs()` and `ctx.paginate()` in depth
