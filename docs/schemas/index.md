# Schemas

`@forinda/kickjs-schema` is the layer between KickJS and your validation library. You write schemas in Zod, Valibot, Yup, or any library that implements [Standard Schema](./standard-schema.md) (ArkType, for example). The framework wraps each one in a `KickSchema`, and request validation, env loading, Swagger, MCP and AI tools, and `kick typegen` all read it through that interface.

`kick new` installs the package along with the library you pick. Most of the time you never import it: you pass a raw schema to a route decorator, and the framework detects the library for you.

```ts
import { Controller, Post, type RequestContext } from '@forinda/kickjs'
import { z } from 'zod'

export const createUserSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
})

@Controller()
export class UserController {
  @Post('/', { body: createUserSchema })
  create(ctx: RequestContext) {
    ctx.created(ctx.body)
  }
}
```

To type `ctx.body` from the schema, use `Ctx<KickRoutes.UserController['create']>` and run `kick typegen`. See [Typed routes](#typed-routes-kick-typegen).

## The `KickSchema` interface

```ts
interface KickSchema<TOutput = unknown, TInput = unknown> {
  /** Validate synchronously: the parsed value, or the issues. */
  safeParse(data: TInput): SchemaResult<TOutput>
  /** Describe the schema as JSON Schema (Swagger, MCP and AI tools read this). */
  toJsonSchema(options?: JsonSchemaOptions): Record<string, unknown>
  /** The schema you passed in, unwrapped. */
  readonly _raw?: unknown
}

interface JsonSchemaOptions {
  readonly target?: 'draft-2020-12' | 'draft-07' | 'openapi-3.0'
  /** 'input' for a request body, query or params; 'output' (the default) for a response. */
  readonly io?: 'input' | 'output'
}

type SchemaResult<T> = { success: true; data: T } | { success: false; issues: SchemaIssue[] }

interface SchemaIssue {
  path: string[]
  message: string
  code: string
  expected?: string
  received?: string
}
```

`io` matters wherever input and output differ: defaults, coercion and transforms. A field with a default is optional on input but always present on output.

`toJsonSchema()` never includes a top-level `$schema` key. When you pass no `target`, each library uses its own default: Zod and Standard JSON Schema libraries use draft 2020-12, and `@valibot/to-json-schema` uses draft-07. Swagger always passes `target: 'openapi-3.0'`.

## Supported libraries

| Library                  | How it is wrapped                | Validation | JSON Schema                                                                                                     |
| ------------------------ | -------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| Zod 4                    | built-in adapter (`fromZod`)     | yes        | Zod's `toJSONSchema()`, with `target` and `io`                                                                  |
| Zod 3 (3.23+)            | built-in adapter (`fromZod`)     | yes        | only `{ type: 'object' }`: Zod 3 has no `toJSONSchema()`                                                        |
| Valibot 1                | built-in adapter (`fromValibot`) | yes        | `@valibot/to-json-schema`, with `target` and `io`; `{ type: 'object' }` and a one-time warning if it is missing |
| Yup 1                    | built-in adapter (`fromYup`)     | yes        | KickJS's own converter, built from `describe()`; `target` is ignored                                            |
| Other Standard Schema v1 | generic Standard Schema wrapper  | sync only  | `~standard.jsonSchema.input/output({ target })` if the library implements Standard JSON Schema                  |

All four library peers are optional. Install the ones you use.

The Zod adapter describes what JSON Schema can't express (a `Map`, a transform's result) as "any value" instead of throwing. It writes dates as `{ type: 'string', format: 'date-time' }` and bigints as `{ type: 'integer' }`. When a request schema has a date or bigint field that JSON can't send, both the Zod and Valibot adapters log a one-time warning. Use `z.coerce.date()` / `z.iso.datetime()` in Zod or `v.pipe(v.string(), v.isoTimestamp())` in Valibot.

Async validation is not supported. If a Standard Schema's `validate` returns a Promise, `safeParse()` throws.

## How a schema is detected

`detectSchema(schema)` returns a `KickSchema` for whatever you pass. It checks in this order, and the first match wins:

1. **Already a `KickSchema`**: an object with `safeParse` and `toJsonSchema` methods. Returned unchanged.
2. **Adapters added with `registerAdapter()`**, in the order you registered them.
3. **Zod**
4. **Valibot**
5. **Yup**
6. **Any other Standard Schema**: ArkType and other Standard Schema v1 libraries (callable ones included).
7. **A plain function**: called with the value. Its return value is the parsed data, and a throw becomes one issue with `code: 'custom'`.
8. **Any other object with `safeParse`**: read as `{ success, data }` or `{ success: false, error: { issues } }`.

Anything else throws `Unrecognized schema`.

Zod, Valibot and Yup all implement Standard Schema too, but their own adapters win. Those adapters report richer issues (`expected`, `received`) and produce better JSON Schema than the generic Standard Schema path.

You can wrap a schema explicitly instead of relying on detection. The result is the same `KickSchema`, typed from the schema:

```ts
import { fromValibot } from '@forinda/kickjs-schema/valibot'
import * as v from 'valibot'

export const createTaskSchema = fromValibot(
  v.object({
    title: v.pipe(v.string(), v.minLength(1)),
    due: v.optional(v.pipe(v.string(), v.isoTimestamp())),
  }),
)
```

### Adding a library

Register an adapter for a library KickJS doesn't recognise. `detect` decides whether the adapter handles a value, and `wrap` turns it into a `KickSchema`:

```ts
import { registerAdapter, type KickSchema } from '@forinda/kickjs-schema'

class Slug {
  readonly pattern = /^[a-z0-9-]+$/
}

registerAdapter({
  name: 'slug',
  detect: (schema) => schema instanceof Slug,
  wrap: (schema): KickSchema<string> => ({
    safeParse: (data) =>
      typeof data === 'string' && (schema as Slug).pattern.test(data)
        ? { success: true, data }
        : { success: false, issues: [{ path: [], message: 'Not a slug', code: 'slug' }] },
    toJsonSchema: () => ({ type: 'string', pattern: (schema as Slug).pattern.source }),
  }),
})
```

Register it before the first request, for example in the file that calls `bootstrap()`. [Schema-agnostic validation](../guide/schema.md#registering-a-custom-adapter) has a complete Joi example.

## Exports

| Import path                      | Exports                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@forinda/kickjs-schema`         | `detectSchema`, `isKickSchema`, `registerAdapter`, `buildRouteTool`; types `KickSchema`, `SchemaResult`, `SchemaIssue`, `JsonSchemaOptions`, `SchemaAdapter`, `InferSchemaOutput`, `RouteTool`, `RouteToolRequest`, `RouteToolSource` |
| `@forinda/kickjs-schema/zod`     | `fromZod`, `isZodSchema`, `zodAdapter`                                                                                                                                                                                                |
| `@forinda/kickjs-schema/valibot` | `fromValibot`, `isValibotSchema`, `valibotAdapter`                                                                                                                                                                                    |
| `@forinda/kickjs-schema/yup`     | `fromYup`, `isYupSchema`, `yupAdapter`                                                                                                                                                                                                |

There is no `/standard` or `/joi` subpath. Pass Standard Schema objects unwrapped. Joi needs a [custom adapter](../guide/schema.md#joi-for-request-bodies).

### What gets loaded

The root entry imports all three built-in adapters, because `detectSchema()` needs them, so importing `@forinda/kickjs-schema` loads all three. `@forinda/kickjs` imports the root entry, which means every KickJS app loads the adapters. Loading them is cheap:

- **Zod and Yup** are never imported by the package. Their adapters detect schemas by shape and call methods on the schema you pass, so neither library is needed unless you use it.
- **Valibot** and **`@valibot/to-json-schema`** are imported when the module loads, if they are installed. A missing package is skipped quietly. `fromValibot()` then throws an install hint, and Valibot JSON Schema falls back to `{ type: 'object' }` with a one-time warning. Any other import error is rethrown.

`kick new` with Valibot installs both `valibot` and `@valibot/to-json-schema`.

## Where the framework uses it

| Consumer                        | What it does with the schema                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Route decorators / `validate()` | `@Get/@Post/...('/path', { body, query, params })` runs `detectSchema(x).safeParse()` on each part and replaces it with the parsed value                                                                                                   |
| `loadEnvFromSchema(schema)`     | Validates `process.env` with any supported schema (`@forinda/kickjs/config`). `defineEnv` / `loadEnv` are the Zod-only helpers                                                                                                             |
| Swagger                         | `detectSchema(x).toJsonSchema({ target: 'openapi-3.0', io })`: `io: 'input'` for request parts, `'output'` for `response`                                                                                                                  |
| MCP and AI tools                | `buildRouteTool()` merges a route's params, query and body schemas into one tool input schema (`io: 'input'`) and turns tool arguments back into a request. Tool `inputSchema` / `outputSchema` go through `detectSchema().toJsonSchema()` |
| `kick typegen`                  | Emits `InferSchemaOutput<typeof schema>` for route and env types                                                                                                                                                                           |

### Environment variables

```ts
// src/config/index.ts
import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

const envSchema = fromZod(
  z.object({
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.url(),
  }),
)

export const env = loadEnvFromSchema(envSchema)
export default envSchema
```

On failure, `loadEnvFromSchema` throws an `Error` listing each issue as `path: message`. See [Configuration](../guide/configuration.md) for how the env module is wired into `src/index.ts`.

### Typed routes (`kick typegen`)

With `typegen.schemaValidator: 'kickjs-schema'` in `kick.config.ts` (the `kick new` default), typegen types each route's `body`, `query` and `params` as `InferSchemaOutput<typeof schema>`. That works for every supported library. `InferSchemaOutput<T>` resolves in this order:

1. a `KickSchema<O>` — its declared output `O`
2. a Standard Schema's output type — Zod 4, Valibot, Yup, ArkType and others
3. Zod 3's and Yup's own output types
4. otherwise `unknown`

`schemaValidator: 'zod'`, which the `kick typegen` command falls back to when `kick.config.ts` doesn't set one, emits `z.infer<typeof schema>` instead. That only works for Zod.

## Validation errors

When a body, query or params schema fails, `validate()` passes an `HttpException` with status 422 to the error handler. The default handler answers with RFC 9457 problem details:

```json
{
  "status": 422,
  "detail": "Invalid email address",
  "type": "about:blank",
  "title": "Unprocessable Entity",
  "errors": [
    { "field": "email", "message": "Invalid email address" },
    { "field": "age", "message": "Too small: expected number to be >=18" }
  ]
}
```

- `detail` is the first issue's message for a body. A failed query gives `Invalid query parameters`, and failed params give `Invalid path parameters`.
- `field` is the issue path joined with `.`.
- `errors` is left out when `NODE_ENV=production`, so request shapes don't leak.
- The HTTP body has no `code`, `expected` or `received`. Those are only on `SchemaIssue`.

`code` comes straight from each library, so the same mistake can have a different code under Zod, Valibot and Yup. Don't branch on it across libraries. [Validation errors](./error-format.md) has the details.

To change the response, pass your own error handler to `bootstrap()`. It replaces the default handler:

```ts
import { bootstrap, errorHandler, HttpException } from '@forinda/kickjs'
import { modules } from './modules'

const defaultHandler = errorHandler()

export const app = await bootstrap({
  modules,
  onError: (err, req, res, next) => {
    if (err instanceof HttpException && err.status === 422) {
      res.status(422).json({ message: err.message, violations: err.details })
      return
    }
    defaultHandler(err, req, res, next)
  },
})
```

## See also

- [Standard Schema v1](./standard-schema.md): the spec, and how KickJS reads it
- [Adapters](./adapters.md)
- [Validation errors](./error-format.md)
- [Framework integration](./integration.md)
- [Schema-agnostic validation guide](../guide/schema.md)
- [Error handling](../guide/error-handling.md)
