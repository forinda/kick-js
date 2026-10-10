# Framework Integration Points

Every part of KickJS that reads a schema goes through `@forinda/kickjs-schema`:

- request validation
- the Swagger spec
- MCP and AI tools
- AI structured output
- env loading
- `kick typegen`

Each one calls `detectSchema(schema)` and works with the `KickSchema` it returns. That's why one Zod, Valibot, Yup or Standard Schema object works everywhere without extra config. This page describes what each integration does with that schema.

## Request Validation

Route decorators take `body`, `query` and `params` schemas. When a route declares any of them, KickJS adds the `validate()` middleware to that route on every runtime (Express, Fastify, h3 and the web/fetch entry):

```ts
import { Controller, Post, type Ctx } from '@forinda/kickjs'
import { z } from 'zod'

const createUserSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
})

@Controller('/users')
export class UserController {
  @Post('/', { body: createUserSchema })
  create(ctx: Ctx<KickRoutes.UserController['create']>) {
    ctx.created(ctx.body)
  }
}
```

For each declared target, in the order **body → query → params**, `validate()`:

1. wraps the schema with `detectSchema()` and calls `.safeParse()` on the raw input
2. on failure, stops and passes a 422 `HttpException` to the error handler. The later targets are not checked
3. on success, replaces `req.body` / `req.query` / `req.params` with the parsed output, so defaults, coercions and transforms apply

The error message depends on the target:

| Target   | Message                                                       |
| -------- | ------------------------------------------------------------- |
| `body`   | the first issue's message (falls back to `Validation failed`) |
| `query`  | `Invalid query parameters`                                    |
| `params` | `Invalid path parameters`                                     |

Each issue becomes `{ field, message }`, where `field` is the issue path joined with dots. The response is a Problem Details body:

```json
{
  "status": 422,
  "title": "Unprocessable Entity",
  "type": "about:blank",
  "detail": "Invalid email address",
  "errors": [{ "field": "email", "message": "Invalid email address" }]
}
```

With `NODE_ENV=production`, `errors` is left out of the response, because the details can reveal the shape of the request; `detail` and the rest stay.

To change this shape, handle the error yourself with `bootstrap({ onError })`. A validation failure arrives there as an `HttpException` with `status` 422 and the `{ field, message }[]` list in `details`:

```ts
import { bootstrap, HttpException } from '@forinda/kickjs'
import { modules } from './modules'

bootstrap({
  modules,
  onError: (err, _req, res) => {
    if (err instanceof HttpException && err.status === 422) {
      res.status(422).json({ message: err.message, issues: err.details })
      return
    }
    res.status(err.status ?? 500).json({ message: err.message })
  },
})
```

See [Validation](../guide/validation.md) and [Error Handling](../guide/error-handling.md) for the full guides.

## Swagger / OpenAPI

`@forinda/kickjs-swagger` converts schemas with its default parser. That parser calls:

```ts
detectSchema(schema).toJsonSchema({ target: 'openapi-3.0', io })
```

`io` is `'input'` for `body`, `query` and `params`, and `'output'` for declared `response` schemas. The two differ for fields with defaults, coercions and transforms. A field with a default is optional on input but always present on output.

The spec is built the first time the spec endpoint (`/openapi.json` by default) is requested, and then cached.

### Component names

Request bodies and responses go into `components.schemas` and are referenced by `$ref`. Each one gets the first free name from this list:

1. **Explicit**: the route's `name` option, with a `Body` suffix. `@Post('/', { body: schema, name: 'CreateUser' })` registers `CreateUserBody`.
2. **Title**: the converted JSON Schema's `title`. For Zod, that's `.meta({ title: '…' })`.
3. **Fallback**: `<Controller><Handler>Body`, with the handler's first letter capitalised. For example, `UserController.create` gives `UserControllerCreateBody`.

Names are stripped of anything that isn't a letter or a digit.

A name that's free, or that already holds the same schema, is reused, so a schema shared by several routes appears once. If an explicit name or a title already holds a different schema, the builder logs a warning and uses the fallback. Two fallbacks can only clash when two controllers with the same class name have the same handler, and those get numbered (`_2`, `_3`, …).

A `body` schema on GET, HEAD, DELETE or OPTIONS is left out of the spec, because OpenAPI 3 allows no request body there. KickJS warns once per route. Validate those inputs with `query` instead.

### Custom parsers (deprecated)

`SwaggerAdapter({ schemaParser })` still accepts a `SchemaParser` (`name`, `supports(schema)`, `toJsonSchema(schema, { io })`) for libraries `detectSchema` can't read. It's deprecated: register an adapter with `registerAdapter()` instead (see [Schema Adapters](./adapters.md)), so validation, tools and typegen pick the library up too.

See [Swagger](../guide/swagger.md) for the adapter itself.

## MCP and AI Tools

`@forinda/kickjs-mcp` and `@forinda/kickjs-ai` both turn routes into tools with `buildRouteTool()` from `@forinda/kickjs-schema`, so a route is exposed the same way to both. The tool's input schema is one JSON Schema object (converted with `io: 'input'`) that merges:

- **path parameters**: always required. Each one is typed from the route's `params` schema, or as a string if there is none
- **body fields**: from `body` on POST, PUT and PATCH. A body that isn't an object (an array, say) becomes a single `body` property
- **query fields**: from `query`

An `inputSchema` option on `@McpTool` / `@AiTool` replaces the query or body part (body on POST/PUT/PATCH, query otherwise). Path parameters are still added. When the tool is called, `toRequest()` splits the arguments back into a URL and a JSON body. The request then goes through the normal HTTP pipeline, so the route's own validation checks the arguments.

Which routes become tools:

- **MCP**: methods decorated with `@McpTool` by default, or every route with `mode: 'auto'`. You can also expose routes through route flags with `exposeWhen`. An `outputSchema` is converted with `io: 'output'`.
- **AI**: methods decorated with `@AiTool`, or routes matched by `exposeWhen`. Tool names default to `<Controller>_<handler>`.

In both adapters, `hideWhen` wins over every other rule.

### AI structured output

`provider.chat({ messages, schema })` and `chatObject()` take any schema `detectSchema` reads. The schema is sent to the model as `toJsonSchema({ io: 'output' })`, and the answer is checked with `safeParse()` before it lands in `response.object`. See [AI → Structured output](../guide/ai.md#structured-output).

See [MCP](../guide/mcp.md) and [AI](../guide/ai.md) for the adapters.

## Environment Validation

There are two loaders:

- **`loadEnvFromSchema(schema)`** takes any schema `detectSchema` reads. It parses `process.env` with `safeParse()` and throws a plain `Error` that lists every failing key. The `kick new` templates for Zod, Valibot and Yup all use it.
- **`defineEnv()` + `loadEnv()`** are Zod-only. `defineEnv` merges your keys over the base schema (`PORT`, `NODE_ENV`, `LOG_LEVEL`).

```ts
// src/config/index.ts
import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromValibot } from '@forinda/kickjs-schema/valibot'
import * as v from 'valibot'

const envSchema = fromValibot(
  v.object({
    PORT: v.optional(v.pipe(v.string(), v.transform(Number)), '3000'),
    DATABASE_URL: v.pipe(v.string(), v.url()),
  }),
)

export const env = loadEnvFromSchema(envSchema)
export default envSchema
```

The loader registers the schema with the env cache that `ConfigService` and `@Value()` read. That only happens if the file runs before `bootstrap()`, so `src/index.ts` must import it first:

```ts
// src/index.ts
import './config'
import { bootstrap } from '@forinda/kickjs'
```

`kick typegen` reads the default export to generate the `KickEnv` type. See [Configuration](../guide/configuration.md).

## Type Generation

`kick typegen` (also run by `kick dev`) scans your controllers without executing them. It writes `.kickjs/types/kick__routes.ts`, which declares a global `KickRoutes` namespace. Each method's entry looks like this:

```ts
declare global {
  namespace KickRoutes {
    interface UserController {
      create: {
        params: {}
        body: import('@forinda/kickjs-schema').InferSchemaOutput<typeof _S0>
        query: unknown
        response: import('@forinda/kickjs').InferHandlerResponse<_C0['create']>
        contextKeys: never
      }
    }
  }
}
```

The entry fields are filled in like this:

- **`body`, `query`, `params`**: from the schemas in the route decorator. Without a schema, `params` falls back to the URL pattern, `query` to the `@ApiQueryParams` shape or `unknown`, and `body` to `unknown`.
- **`response`**: from a declared `response` schema, or else from the handler's return type.

A schema is only resolved if typegen can find it statically: it must be a named identifier that is exported from the controller file or imported with a static specifier. Otherwise typegen warns and uses the fallback.

How a schema becomes a type depends on `typegen.schemaValidator` in `kick.config.ts`:

| Value             | Emitted type                                                                |
| ----------------- | --------------------------------------------------------------------------- |
| `'kickjs-schema'` | `InferSchemaOutput<typeof schema>`, which works for every supported library |
| `'zod'`           | `z.infer<typeof schema>`, for Zod only                                      |
| `false`           | no schema-driven types                                                      |

`kick new` and `kick g config` both write `'kickjs-schema'`. If the option is missing, it defaults to `'zod'`, so projects that use Valibot or Yup must set it.

`InferSchemaOutput<T>` checks, in order:

1. `KickSchema<O>`
2. Standard Schema `~standard.types.output`
3. Zod's `~output`, then `_output`
4. Yup's `__outputType`
5. otherwise `unknown`

### Typed handlers

A plain `ctx: RequestContext` doesn't type `ctx.body`. To get the validated types, annotate the handler with the generated entry:

```ts
import { Controller, Post, type Ctx } from '@forinda/kickjs'
import { createUserSchema } from './user.dtos'

@Controller('/users')
export class UserController {
  @Post('/', { body: createUserSchema })
  create(ctx: Ctx<KickRoutes.UserController['create']>) {
    ctx.body.email // string, inferred from createUserSchema
    ctx.created(ctx.body)
  }
}
```

See [Type Generation](../guide/typegen.md).

## Library Notes

- **Standard Schema**: any object, or callable (ArkType, for example), with a `~standard` property is detected. If the library also implements Standard JSON Schema, its `jsonSchema.input()` / `output()` is called with the caller's `target` (default `draft-2020-12`, `openapi-3.0` from Swagger). `io: 'input'` selects `input()` and anything else `output()`. See [Standard Schema](./standard-schema.md).
- **Valibot**: JSON Schema conversion uses the optional peer `@valibot/to-json-schema`, which `kick new` installs with the Valibot template. Without it, Valibot schemas are described as `{ type: 'object' }`, so Swagger and AI tools show no fields, and a one-time console warning says so. Validation still works.
