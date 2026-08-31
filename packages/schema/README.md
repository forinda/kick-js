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

One wrapper per library, each behind its own subpath so you pay for only what
you import — see the table below.

To support a library that has no wrapper, register an adapter. It is three
members: a `name`, a `detect` that recognises the library's schemas, and a
`wrap` that returns a `KickSchema` — meaning **both** `safeParse` and
`toJsonSchema`, since the second is what feeds OpenAPI generation:

```ts
import { registerAdapter, type SchemaAdapter } from '@forinda/kickjs-schema'
import Joi from 'joi'
import joiToJson from 'joi-to-json'

registerAdapter({
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
})
```

[The guide](https://kickjs.app/guide/schema) has the full worked Joi adapter,
the `detectSchema()` resolution order, and how `InferSchemaOutput<T>` unwraps a
type.

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
