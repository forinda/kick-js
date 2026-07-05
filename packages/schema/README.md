# @forinda/kickjs-schema

Schema-agnostic validation abstraction for KickJS. Wraps Zod, Valibot, Yup, or any Standard-Schema-compliant validator behind a single `KickSchema` interface so route validation, env loading, swagger spec generation, and `kick typegen` all share one definition.

You pick the validation library. The framework doesn't care.

## Why this package exists

Before the schema package landed, every kickjs subsystem hard-coded Zod:

- `@Post('/', { body: zodSchema })` validated only Zod
- `loadEnv(zodSchema)` only Zod
- The Swagger spec generator only understood Zod
- `kick typegen` emitted `z.infer<typeof Schema>` literally

That made the framework opinionated about Zod **and** silently broke for teams already shipping on Valibot or Yup. The schema package decouples the framework from any specific validator: every subsystem normalises whatever the adopter passes through `detectSchema()`, which wraps the input as a `KickSchema` and routes calls to the right adapter.

## Install

```bash
pnpm add @forinda/kickjs-schema
```

`kick new` installs it automatically. The Zod / Valibot / Yup peers are declared as optional — install only the one(s) you actually use:

```bash
pnpm add zod        # default for kick new
# or
pnpm add valibot
# or
pnpm add yup
```

## Quick start

### Env loading

```ts
// src/config/index.ts
import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

const envSchema = fromZod(
  z.object({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
  }),
)

export const env = loadEnvFromSchema(envSchema)
export default envSchema
```

`env.DATABASE_URL` is typed `string`. `kick typegen` reads the default export and populates `KickEnv`. Swap `fromZod` for `fromValibot` or `fromYup` to use a different library — the surrounding wiring stays identical.

### Route validation

Pass the **raw library schema** to the route decorator — `detectSchema()` wraps it automatically:

```ts
import { Controller, Post } from '@forinda/kickjs'
import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

@Controller()
export class UserController {
  @Post('/', { body: createUserSchema })
  create(ctx) {
    // ctx.body typed { name: string; email: string }
  }
}
```

Mix libraries per call site — one controller can use Zod, another Valibot, the env Yup. `detectSchema()` resolves each one independently.

## The `KickSchema` interface

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

`safeParse` powers validation. `toJsonSchema` powers OpenAPI generation. `_raw` carries the underlying library's schema instance — adapter authors can read it back for library-specific operations without leaking the source library through public types.

## Adapters

### `fromZod` — `@forinda/kickjs-schema/zod`

```ts
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

const wrapped = fromZod(z.object({ name: z.string() }))
```

- Detection: object with `safeParse` and `_def` (Zod's internal brand).
- Output inference: reads `~standard.types.output` (Zod v4 Standard Schema brand), falls back to `_output` (Zod v3).
- `toJsonSchema()`: uses `schema.toJSONSchema()` directly when available.

Cast when you need to spell the output type explicitly:

```ts
const wrapped = fromZod(z.string()) as KickSchema<MyBranded>
```

### `fromValibot` — `@forinda/kickjs-schema/valibot`

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

- Detection: object with `kind`, `type`, `async` properties.
- Output inference: reads Valibot's Standard Schema brand directly.
- `toJsonSchema()`: delegates to `@valibot/to-json-schema` (loaded lazily — no import cost when unused).

**Default behaviour.** `v.optional(<pipe>, default)` validates the default _through_ the pipe — `v.optional(v.pipe(v.string(), v.transform(Number)), '3000')` yields `3000: number`, not the raw `'3000'` string.

### `fromYup` — `@forinda/kickjs-schema/yup`

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

- Detection: object with `validateSync`, `describe`, `isValidSync`.
- Output inference: reads Yup's `__outputType` brand.
- `toJsonSchema()`: walks `describe()` output (Yup ships no native JSON Schema).

**Caveats.**

- `.url()` matches http/https only. Use `.string().required()` or `.matches(/^[a-z]+:\/\/…/)` for connection strings like `postgres://…`.
- `.required()` fields type as `T | undefined` because `.required()` is enforced at runtime, not in the type. The validate middleware still rejects undefined at runtime.
- `toJsonSchema()` covers primitives, enums, `min` / `max`, `oneOf`, nested objects, arrays. Custom tests and `.when()` conditionals fall back to the base type.

## `detectSchema(schema)`

The framework calls this whenever it receives an unknown schema. Resolution order (top wins):

1. `isKickSchema(schema)` — already wrapped, returned as-is
2. Custom adapters registered via `registerAdapter`
3. Zod (`isZodSchema`) → `fromZod`
4. Valibot (`isValibotSchema`) → `fromValibot`
5. Yup (`isYupSchema`) → `fromYup`
6. Standard Schema v1 (`hasStandardSchema`) → `fromStandardSchema`
7. `typeof schema === 'function'` → wrapped as a plain validator (returns or throws)
8. `safeParse`-only duck-type → `fromSafeParseDuckType`

Failure throws `Error('Unrecognized schema. Wrap it with fromZod(), fromValibot(), etc., or implement the StandardSchemaV1 interface.')`.

## Custom adapters

```ts
import { registerAdapter, type SchemaAdapter } from '@forinda/kickjs-schema'
import Joi from 'joi'
import joiToJson from 'joi-to-json'

const joiAdapter: SchemaAdapter = {
  name: 'joi',
  detect: (schema): boolean => Joi.isSchema(schema),
  wrap: (schema) => ({
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

Custom adapters run between the KickSchema passthrough and the built-in Zod / Valibot / Yup detectors, so an adopter who wants Joi (or a fork of Zod with different internals) plugs in without forking the framework.

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

## Subpath exports

| Specifier                        | Exports                                            | Notes                                       |
| -------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| `@forinda/kickjs-schema`         | Types + `detectSchema` + `registerAdapter`         | Always available; no library peer required. |
| `@forinda/kickjs-schema/zod`     | `fromZod`, `isZodSchema`, `zodAdapter`             | Requires `zod` peer.                        |
| `@forinda/kickjs-schema/valibot` | `fromValibot`, `isValibotSchema`, `valibotAdapter` | Requires `valibot` peer.                    |
| `@forinda/kickjs-schema/yup`     | `fromYup`, `isYupSchema`, `yupAdapter`             | Requires `yup` peer.                        |

All three library peers are declared `optional` in `peerDependenciesMeta`, so installing one doesn't drag in the others.

## See also

- [Schema-agnostic validation guide](https://kickjs.app/guide/schema.html) — full prose docs
- [Configuration](https://kickjs.app/guide/configuration.html) — env loading with `loadEnvFromSchema`
- [Validation](https://kickjs.app/guide/validation.html) — `@Post body` / `@Get query` / params validation
- [Type Generation](https://kickjs.app/guide/typegen.html) — `schemaValidator: 'kickjs-schema'` codegen

## License

MIT
