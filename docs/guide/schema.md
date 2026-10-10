# Schema-agnostic validation

`@forinda/kickjs-schema` is a thin abstraction over Zod, Valibot, Yup, and any future Standard-Schema-compliant validator. It exposes a single `KickSchema` interface that the rest of the framework consumes — route validation, env loading, swagger spec generation, and `kick typegen` all flow through the same definition. You pick the validation library; the framework doesn't care.

::: tip One package, three libraries
Install once (`@forinda/kickjs-schema` ships with `kick new`), then bring whichever validator you prefer:

- **Zod** — broadest ecosystem, default for `kick new`.
- **Valibot** — smaller bundle, Standard Schema brand for first-class inference.
- **Yup** — classic API, browser-friendly.

Or mix them per call site — one DTO with Zod, another with Valibot, env with Yup. `detectSchema()` figures out the right adapter at runtime.
:::

## Why this package exists

Before the schema package landed, every kickjs subsystem hard-coded Zod:

- `@Post('/', { body: zodSchema })` validated only Zod
- `loadEnv(zodSchema)` only Zod
- The Swagger spec generator only understood Zod
- `kick typegen` emitted `z.infer<typeof Schema>` literally

That made the framework opinionated about Zod **and** silently broke for the small but real fraction of teams that already shipped on Valibot or Yup. The schema package decouples the framework from any specific validator: each subsystem normalises whatever the adopter passes through `detectSchema()`, which wraps the input as a `KickSchema` and routes calls to the right adapter.

## Quick start

```ts
// src/config/index.ts
import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

const envSchema = fromZod(
  z.object({
    DATABASE_URL: z.url(),
    JWT_SECRET: z.string().min(32),
  }),
)

export const env = loadEnvFromSchema(envSchema)
export default envSchema
```

The same `envSchema` shape works for body / query / params validation — pass the **raw library schema** (not the wrapped one) to the route decorator; `detectSchema()` wraps it on the way in:

```ts
import { Controller, Post, type Ctx } from '@forinda/kickjs'
import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
})

@Controller()
export class UserController {
  @Post('/', { body: createUserSchema })
  create(ctx: Ctx<KickRoutes.UserController['create']>) {
    // ctx.body is typed { name: string; email: string }
  }
}
```

The body is validated at runtime either way. Its _type_ comes from `kick typegen`, which generates the global `KickRoutes` namespace from your route decorators — see [Type Generation](typegen.md). A handler typed as plain `RequestContext` gets an untyped `ctx.body`.

## The `KickSchema` interface

Every adapter returns an object satisfying:

```ts
interface KickSchema<TOutput = unknown, TInput = unknown> {
  safeParse(data: TInput): SchemaResult<TOutput>
  toJsonSchema(options?: JsonSchemaOptions): Record<string, unknown>
  readonly _raw?: unknown
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

`safeParse` powers validation. `toJsonSchema` powers OpenAPI generation. `_raw` carries the underlying library's schema instance — adapter authors can read it back for library-specific operations (e.g. swagger's `$ref` naming) without leaking the source library through the framework's public types.

## Adapters

### `fromZod`

```ts
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

const wrapped = fromZod(z.object({ name: z.string() }))
wrapped.safeParse({ name: 'Ada' }) // { success: true, data: { name: 'Ada' } }
wrapped.toJsonSchema() // JSON Schema draft 2020-12
wrapped.toJsonSchema({ target: 'openapi-3.0' }) // what Swagger asks for
```

`toJsonSchema(options)` takes a `target` — `'draft-2020-12'` (Zod's default), `'draft-07'` or `'openapi-3.0'` — and `io`: `'output'` (the default) describes what the schema produces, `'input'` what it accepts; they differ for defaults, coercion and transforms. A nullable string is `type: ['string', 'null']` in 2020-12 and `nullable: true` in OpenAPI 3.0. What JSON Schema can't express (a `Map`, a transform's result) is described as any value; dates are `string` / `date-time` and bigints `integer`.

Detection: the schema is a non-null object with a `safeParse` function and a `_def` property (Zod's internal brand).

Output inference: `InferSchemaOutput<TSchema>` reads the Standard Schema brand (`~standard.types.output`) on Zod v4, falls back to `_output` for Zod v3. The single inferring overload pulls the parsed shape from the call site so `fromZod(z.object({...}))` lands at `KickSchema<{ ... }>`, not `KickSchema<unknown>`. Spell the output explicitly with a cast when you need to:

```ts
import type { KickSchema } from '@forinda/kickjs-schema'

const wrapped = fromZod(z.string()) as KickSchema<MyBranded>
```

### `fromValibot`

```ts
import { fromValibot } from '@forinda/kickjs-schema/valibot'
import * as v from 'valibot'

const wrapped = fromValibot(
  v.object({
    name: v.string(),
    age: v.optional(v.pipe(v.string(), v.transform(Number)), '0'),
  }),
)
```

Detection: a non-null object with `kind`, `type`, and `async` properties (Valibot's internal brand). Output inference reads Valibot's Standard Schema brand directly.

**Default behaviour.** `v.optional(<pipe>, default)` validates the default _through_ the pipe — so `v.optional(v.pipe(v.string(), v.transform(Number)), '3000')` yields `3000: number` for `undefined` input, not the raw `'3000'` string. The output type is consistent with the transform.

**JSON Schema.** `toJsonSchema()` delegates to `@valibot/to-json-schema`, an optional peer that `kick new` installs with Valibot. Add it yourself to an existing app — `pnpm add @valibot/to-json-schema` — or Swagger and AI tools see every Valibot schema as `{ type: 'object' }` (a one-time warning says so). Both `valibot` and the converter are loaded when the package is imported, if they're installed.

### `fromYup`

```ts
import { fromYup } from '@forinda/kickjs-schema/yup'
import * as yup from 'yup'

const wrapped = fromYup(
  yup.object({
    name: yup.string().required(),
    age: yup.number().min(0).required(),
  }),
)
```

Detection: a non-null object with `validateSync`, `describe`, and `isValidSync` functions (Yup's API surface).

**Caveats.**

- Yup's `.url()` only matches http/https. For database connection strings like `postgres://…` use `.string().required()` or `.matches(/^[a-z]+:\/\/…/)`.
- Yup's `__outputType` types `.required()` fields as `T | undefined` because `.required()` is enforced at runtime, not in the type. The validate middleware still rejects undefined at runtime; the type-level looseness only surfaces in tests that bypass validation.
- `fromYup.toJsonSchema()` walks `describe()` output rather than reading native JSON Schema (Yup doesn't ship one). Coverage is good for primitives, enums, `min`/`max`, `oneOf`, and nested objects/arrays. Anything exotic (custom tests, `.when()` conditionals) falls back to the base type.

## `detectSchema(schema)` — runtime adapter routing

The framework calls `detectSchema()` whenever it receives an unknown schema:

```ts
import { detectSchema } from '@forinda/kickjs-schema'

const wrapped = detectSchema(myZodSchema) // → fromZod(myZodSchema)
const wrapped = detectSchema(myValibotSchema) // → fromValibot(myValibotSchema)
const wrapped = detectSchema(myYupSchema) // → fromYup(myYupSchema)
```

Resolution order:

1. **`isKickSchema(schema)`** — already wrapped, returned as-is.
2. **Custom adapters** registered via `registerAdapter(adapter)`.
3. **`isZodSchema(schema)`** → `fromZod`
4. **`isValibotSchema(schema)`** → `fromValibot`
5. **`isYupSchema(schema)`** → `fromYup`
6. **`hasStandardSchema(schema)`** → `fromStandardSchema` (any Standard Schema v1 implementer not covered above)
7. **`typeof schema === 'function'`** → wrapped as a plain validator; the function receives the data and either returns the validated value or throws.
8. **`safeParse`-only duck-type** → wrapped via `fromSafeParseDuckType` (a generic fallback for schema libraries that look like Zod but aren't).

Failure falls through to a thrown `Error` with the message `Unrecognized schema. Wrap it with fromZod(), fromValibot(), etc., or implement the StandardSchemaV1 interface.`.

## Registering a custom adapter

```ts
import { registerAdapter, type KickSchema, type SchemaAdapter } from '@forinda/kickjs-schema'
import Joi from 'joi'
import joiToJson from 'joi-to-json'

const joiAdapter: SchemaAdapter = {
  name: 'joi',
  detect: (schema): boolean => Joi.isSchema(schema),
  wrap: (schema): KickSchema => ({
    safeParse(data) {
      const { value, error } = (schema as Joi.Schema).validate(data, { abortEarly: false })
      if (error) {
        return {
          success: false,
          issues: error.details.map((d) => ({
            path: d.path.map(String),
            message: d.message,
            code: d.type,
          })),
        }
      }
      return { success: true, data: value }
    },
    toJsonSchema() {
      return joiToJson(schema as Joi.Schema)
    },
    _raw: schema,
  }),
}

registerAdapter(joiAdapter)
```

Custom adapters sit between the KickSchema passthrough and the built-in Zod/Valibot/Yup detectors, so an adopter who genuinely wants Joi (or a fork of Zod with different internals) plugs in without forking the framework.

### Where to register it

`registerAdapter` mutates a module-level list, so it has to run before anything
calls `detectSchema` — that means before `bootstrap()`. The reliable spot is the
top of `src/config/index.ts`, which `src/index.ts` already imports as a side
effect before bootstrap for the env schema:

```ts
// src/config/index.ts
import { registerAdapter } from '@forinda/kickjs-schema'
import { joiAdapter } from './joi-adapter'

registerAdapter(joiAdapter) // ← before any schema is detected

// ...env schema below
```

A plugin's `build()` works too, as long as the plugin is registered in
`bootstrap({ plugins })` rather than resolved lazily.

### Joi for request bodies

Once registered, a raw Joi schema is accepted anywhere a schema is:

```ts
@Post('/users', {
  body: Joi.object({
    name: Joi.string().min(2).required(),
    age: Joi.number().integer().min(0),
  }),
})
create(ctx: RequestContext) {
  ctx.json({ got: ctx.body }) // coerced: age is a number
}
```

A violation answers **422** in the standard problem shape, with Joi's own
messages and its `path` mapped onto `field`:

```json
{
  "status": 422,
  "title": "Unprocessable Entity",
  "type": "about:blank",
  "detail": "\"name\" length must be at least 2 characters long",
  "errors": [{ "field": "name", "message": "\"name\" length must be at least 2 characters long" }]
}
```

### Joi for env

The same adapter drives `loadEnvFromSchema`, including coercion — a
`Joi.number()` key arrives as a number, not the string `process.env` held:

```ts
// src/config/index.ts
import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { detectSchema } from '@forinda/kickjs-schema'
import Joi from 'joi'

const envSchema = detectSchema(
  Joi.object({
    PORT: Joi.number().default(3000),
    DATABASE_URL: Joi.string().uri().required(),
  }).unknown(true), // ← required, see below
)

export const env = loadEnvFromSchema(envSchema)
export default envSchema
```

::: danger `.unknown(true)` is not optional for env schemas
The env schema is validated against the whole of `process.env`, which carries
hundreds of keys you never declared. A Zod object strips unknown keys silently;
**Joi rejects them**, so a schema without `.unknown(true)` fails at boot with a
list of everything else in your environment:

```
Environment validation failed:
  VITEST_WORKER_ID: "VITEST_WORKER_ID" is not allowed
  npm_config_registry: "npm_config_registry" is not allowed
  ...
```

The same applies to any adapter whose library treats unknown keys as an error.
:::

### Typing: cast the schema you pass

`InferSchemaOutput` has no Joi branch, so a raw Joi schema infers `unknown` —
`KickEnv` stays empty and `ctx.body` is untyped. Registering the adapter
doesn't change that: it works at runtime, while typegen reads the static type
of the value you hand to `loadEnvFromSchema` or a route. Its first branch reads
`KickSchema<TOutput>`, so typing that value is what restores inference:

```ts
interface AppEnv {
  PORT: number
  DATABASE_URL: string
}

const envSchema = detectSchema(joiEnv) as KickSchema<AppEnv>
// InferSchemaOutput<typeof envSchema> === AppEnv → typed KickEnv, typed @Value()

// The same for a route: pass the typed value, not the raw Joi schema.
const createUser = detectSchema(joiCreateUser) as KickSchema<CreateUser>
// @Post('/', { body: createUser }) → ctx.body: CreateUser
```

Joi has no static inference of its own, so `AppEnv` is written by hand and the
cast is the seam where you promise the two agree. Zod and Valibot skip this
step because their schemas carry their output type.

### `toJsonSchema` is what Swagger reads

The adapter's `toJsonSchema()` feeds the OpenAPI spec. Returning `{}` (or a
placeholder) leaves every Joi-validated route documented as an empty object —
validation still works, the docs just say nothing. `joi-to-json` covers the
common cases:

```bash
pnpm add joi-to-json
```

::: tip Verified
The adapter above was run end to end: `detectSchema` resolution, request-body
validation (200 with coerced values / 422 with mapped issues), and
`loadEnvFromSchema` + `ConfigService.get()` returning a coerced `number`.
:::

## `InferSchemaOutput<T>`

Type-level inference of a schema's parsed output. `kick typegen` runs this against the env schema's default export (under `schemaValidator: 'kickjs-schema'`) to populate `KickEnv`, and the validate middleware uses it to type `ctx.body` / `ctx.query` / `ctx.params`.

Resolution order (top wins):

1. `T extends KickSchema<infer O>` → `O`
2. `T extends { '~standard': { types?: { output: infer O } } }` → `O` (Zod v4, Valibot, any Standard Schema implementer)
3. `T extends { '~output': infer O }` → `O` (Zod v4 fallback)
4. `T extends { _output: infer O }` → `O` (Zod v3)
5. `T extends { __outputType: infer O }` → `O` (Yup)
6. `unknown`

The Standard Schema branch sits ahead of Zod's `_output` because Zod v4 sometimes types `_output` as `never` on object schemas — falling through to `~standard` lands at the real output shape.

## How the framework wires it up

```
       ┌─────────────────────────────────────────────────┐
       │                  Your code                      │
       │   z.object({...}) / v.object({...}) / yup.x()   │
       └──────────────────────┬──────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
       │ @Post body  │ │ loadEnvFrom │ │   Swagger   │
       │   schema    │ │   Schema()  │ │   spec gen  │
       └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                  ┌───────────────────────┐
                  │   detectSchema()      │
                  │ (kickjs-schema)       │
                  └───────────┬───────────┘
                              ▼
                       KickSchema<T>
                  (safeParse + toJsonSchema)
```

Three subsystems, one abstraction. Swapping Zod for Valibot in the env schema doesn't ripple through to body validation, swagger, or typegen — they all keep working unchanged.

## API reference

### Exports

```ts
// Types
export type {
  KickSchema, // wrapped schema shape
  SchemaResult, // safeParse return shape
  SchemaIssue, // single validation issue
  JsonSchemaOptions, // toJsonSchema options
  SchemaAdapter, // shape for custom adapters
  InferSchemaOutput, // type-level inference helper
}

// Runtime
export { detectSchema, isKickSchema, registerAdapter, buildRouteTool }
```

`buildRouteTool` turns a route's `params`, `query` and `body` schemas into one input JSON Schema for a tool call — what the MCP and AI adapters expose routes with.

### Subpath exports

| Specifier                        | Exports                                            | Notes                                                          |
| -------------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `@forinda/kickjs-schema`         | Types + `detectSchema`                             | Always available; no library peer required.                    |
| `@forinda/kickjs-schema/zod`     | `fromZod`, `isZodSchema`, `zodAdapter`             | Requires `zod` as a peer in your app.                          |
| `@forinda/kickjs-schema/valibot` | `fromValibot`, `isValibotSchema`, `valibotAdapter` | Requires `valibot`; `@valibot/to-json-schema` for JSON Schema. |
| `@forinda/kickjs-schema/yup`     | `fromYup`, `isYupSchema`, `yupAdapter`             | Requires `yup` as a peer.                                      |

All library peers — and `@valibot/to-json-schema` — are declared `optional` in the package's `peerDependenciesMeta`, so installing one doesn't drag in the others. The root entry imports all three adapters (to detect any schema), but `zod` and `yup` are never imported by them; `valibot` is, when it's installed.

## See also

- [Configuration](configuration.md) — env loading with `loadEnvFromSchema`
- [Validation](validation.md) — `@Post body` / `@Get query` / params validation
- [Type Generation](typegen.md) — `schemaValidator: 'kickjs-schema'` codegen
- [Swagger / OpenAPI](swagger.md) — schema-driven spec generation
