# Schema Adapters

Each adapter wraps a validation library in the unified `KickSchema` interface: a synchronous `safeParse()` that returns `{ success: true, data }` or `{ success: false, issues: SchemaIssue[] }`, and a `toJsonSchema()` that Swagger and the AI tools read.

You rarely call an adapter yourself. `validate()`, route decorators, `loadEnvFromSchema()` and Swagger pass every schema through `detectSchema()`, which picks the adapter for you (see [Auto-detection](#auto-detection)). Wrap a schema explicitly when you want the typed `KickSchema<T>` value — for example to share it between a route and a test.

Zod, Valibot and Yup are optional peer dependencies — install the ones you use. They are never bundled into `@forinda/kickjs-schema`. The root entry imports all three adapter modules, though, and the Valibot one loads `valibot` and `@valibot/to-json-schema` at startup when they are installed.

| Library         | Wrapper       | Import from                      |
| --------------- | ------------- | -------------------------------- |
| Zod             | `fromZod`     | `@forinda/kickjs-schema/zod`     |
| Valibot         | `fromValibot` | `@forinda/kickjs-schema/valibot` |
| Yup             | `fromYup`     | `@forinda/kickjs-schema/yup`     |
| Standard Schema | —             | pass the schema as-is            |
| Anything else   | your own      | `registerAdapter()` (see below)  |

Each subpath also exports a detector and an adapter object (`isZodSchema` / `zodAdapter`, `isValibotSchema` / `valibotAdapter`, `isYupSchema` / `yupAdapter`).

Issue `code`s are passed through from each library, not normalised — a Zod email failure is `invalid_format`, a Valibot one is `email`, a Yup one is `email`. See [Error Format](./error-format.md).

## Zod Adapter

```ts
import { fromZod } from '@forinda/kickjs-schema/zod'
import type { KickSchema } from '@forinda/kickjs-schema'
import { z } from 'zod'

const CreateUser = fromZod(
  z.object({
    name: z.string().min(1),
    email: z.email(),
    age: z.number().int().min(18),
  }),
)

// Type inference preserved
type CreateUserInput = typeof CreateUser extends KickSchema<infer T> ? T : never
// { name: string; email: string; age: number }
```

**Validation**: calls `schema.safeParse(data)` and maps `error.issues` to `SchemaIssue[]`.

**JSON Schema**: calls Zod 4's `schema.toJSONSchema()`, forwarding `target` (`draft-2020-12`, `draft-07`, `openapi-3.0`) and `io` (`'input'` for request schemas, `'output'` for responses). The `$schema` key is stripped. On top of Zod's output:

- What JSON Schema can't express (a `Map`, a transform's result, a custom check) becomes `{}` (any value) instead of throwing.
- `z.date()` becomes `{ type: 'string', format: 'date-time' }`; `z.bigint()` becomes `{ type: 'integer' }` (plus `format: 'int64'` for `z.int64()`).
- When a request schema (`io: 'input'`) has a `z.date()` or `z.bigint()` that isn't coerced, KickJS logs a one-time warning — JSON can't send a `Date`, so the route rejects every request. Use `z.coerce.date()` / `z.iso.datetime()` or `z.coerce.bigint()`.

Zod 3 schemas validate fine but have no `toJSONSchema()`, so they are described as `{ type: 'object' }`.

**Error mapping**:

```text
issue.path          → SchemaIssue.path (each segment stringified)
issue.message       → SchemaIssue.message
issue.code          → SchemaIssue.code ("invalid_type", "too_small", "invalid_format", ...)
issue.expected      → SchemaIssue.expected (when present)
issue.received      → SchemaIssue.received (when present — Zod 4 issues don't carry it)
too_small / too_big → expected = ">=min" / "<=max"; received = the input, if Zod reported it
```

## Valibot Adapter

```ts
import { fromValibot } from '@forinda/kickjs-schema/valibot'
import * as v from 'valibot'

const CreateUser = fromValibot(
  v.object({
    name: v.pipe(v.string(), v.minLength(1)),
    email: v.pipe(v.string(), v.email()),
    age: v.pipe(v.number(), v.integer(), v.minValue(18)),
  }),
)
```

**Validation**: calls `v.safeParse(schema, data)` and maps `result.issues` to `SchemaIssue[]`. `fromValibot()` throws a clear error if `valibot` isn't installed.

**JSON Schema**: uses `@valibot/to-json-schema` (an optional peer — `kick new` installs it with the Valibot template; otherwise `pnpm add @valibot/to-json-schema`). `target` (`draft-2020-12`, `draft-07`, `openapi-3.0`) is forwarded, and `io` becomes the converter's `typeMode`. Unsupported pieces become any value instead of throwing, `v.date()` becomes `{ type: 'string', format: 'date-time' }` and `v.bigint()` becomes `{ type: 'integer' }`. A date or bigint in a request schema logs the same one-time warning as Zod (Valibot doesn't coerce; use `v.pipe(v.string(), v.isoTimestamp())`).

Without `@valibot/to-json-schema`, every Valibot schema is described as `{ type: 'object' }` and KickJS logs a one-time warning — validation still works, but Swagger and AI tools show no fields.

**Error mapping**:

```text
issue.path[].key    → SchemaIssue.path (string[])
issue.message       → SchemaIssue.message
issue.type          → SchemaIssue.code ("string", "min_length", "email", ...)
issue.expected      → SchemaIssue.expected (omitted when Valibot reports none, e.g. email)
issue.received      → SchemaIssue.received (as Valibot formats it, e.g. '"x"')
```

## Yup Adapter

```ts
import { fromYup } from '@forinda/kickjs-schema/yup'
import * as yup from 'yup'

const CreateUser = fromYup(
  yup.object({
    name: yup.string().required().min(1),
    email: yup.string().required().email(),
    age: yup.number().required().integer().min(18),
  }),
)
```

**Validation**: calls `schema.validateSync(data, { abortEarly: false, stripUnknown: false })` and maps the `ValidationError`'s `inner` errors to `SchemaIssue[]` (or the error itself when `inner` is empty). Any other error is rethrown. Validation is synchronous, so a schema with an async `.test()` throws instead of returning issues — keep request schemas synchronous.

**JSON Schema**: built in — KickJS walks `schema.describe()`. It ignores `target` and `io`, and maps:

- `object` → `properties` + `required` (fields that are neither optional nor nullable), `array` → `items`
- `string`, `number`, `boolean`; `date` → `{ type: 'string', format: 'date-time' }`; anything else (`mixed`, `tuple`, `lazy`) → `{}`
- `.email()` → `format: 'email'`, `.url()` → `format: 'uri'`
- `.min()` / `.max()` → `minimum` / `maximum` on numbers, `minLength` / `maxLength` otherwise
- `.oneOf()` → `enum`

`.integer()` is not reflected — the field stays `type: 'number'`.

**Error mapping**:

```text
error.path          → SchemaIssue.path (split on '.'; "items[0].name" → ["items[0]", "name"])
error.message       → SchemaIssue.message
error.type          → SchemaIssue.code ("required", "min", "email", "optionality", ...)
error.params        → SchemaIssue.expected (">=min", "<=max", or the regex)
```

## Standard Schema (Universal)

There is no wrapper to import: pass any [Standard Schema v1](./standard-schema.md) object — or a callable one, such as an ArkType type — straight to `validate()`, a route decorator or `detectSchema()`.

```ts
import { detectSchema } from '@forinda/kickjs-schema'

const CreateUser = detectSchema(anyStandardSchemaV1Object) // KickSchema
```

Zod 4 and Valibot also implement Standard Schema, but they are matched by their own adapters first, which keep their issue codes and JSON Schema support.

**Validation**: calls `schema['~standard'].validate(data)`. Only synchronous validators are supported — if `validate()` returns a Promise, `safeParse()` throws.

**JSON Schema**: when the library implements Standard JSON Schema, calls `~standard.jsonSchema.input({ target })` for `io: 'input'` and `~standard.jsonSchema.output({ target })` otherwise, with the caller's `target` (default `draft-2020-12`), and strips `$schema`. Otherwise it falls back to the schema's own `toJSONSchema()`, then to `{ type: 'object' }`.

**Error mapping**:

```text
issue.path          → SchemaIssue.path (PathSegment.key or PropertyKey, stringified)
issue.message       → SchemaIssue.message
(no code in spec)   → SchemaIssue.code = "validation"
```

## Joi

There is no built-in Joi adapter. Joi has no static type inference, so a Joi schema can't give you a typed `ctx.body`. If you still want Joi, wrap it yourself and register it with [`registerAdapter()`](#writing-a-custom-adapter), casting the result to `KickSchema<T>` for types.

## Auto-detection

When a raw (unwrapped) schema reaches `validate()`, a route decorator, `loadEnvFromSchema()` or Swagger, `detectSchema()` checks, in order:

1. **Already a `KickSchema`** — an object with `safeParse()` and `toJsonSchema()` methods. Returned as-is.
2. **Registered adapters** — every `registerAdapter()` entry, in registration order. The first `detect()` that returns `true` wins.
3. **Zod** — has `safeParse()` and `_def`.
4. **Valibot** — has `kind`, `type` and `async`.
5. **Yup** — has `validateSync()`, `describe()` and `isValidSync()`.
6. **Standard Schema** — an object or function with a `~standard` property.
7. **Plain function** — called with the data; its return value becomes `data`, and a thrown error becomes one issue with `code: 'custom'`. JSON Schema is `{ type: 'object' }`.
8. **Anything with `safeParse()`** — a duck-typed fallback. Issues are read from `result.error.issues` or `result.issues`, `code` defaults to `'unknown'`, and JSON Schema comes from `toJSONSchema()` if present, else `{ type: 'object' }`.

Anything else throws `Unrecognized schema. Wrap it with fromZod(), fromValibot(), etc., or implement the StandardSchemaV1 interface.`

Because registered adapters run before the built-in checks, `registerAdapter()` can also override how Zod, Valibot or Yup schemas are handled.

## Writing a Custom Adapter

For libraries not listed above, implement `KickSchema<T>`:

```ts
import type { KickSchema, SchemaResult } from '@forinda/kickjs-schema'
import { MyLibrarySchema } from 'my-library'

function fromMyLibrary<T>(schema: MyLibrarySchema<T>): KickSchema<T> {
  return {
    safeParse(data: unknown): SchemaResult<T> {
      const result = schema.check(data)
      if (result.valid) {
        return { success: true, data: result.value }
      }
      return {
        success: false,
        issues: result.errors.map((e) => ({
          path: e.location.split('.'),
          message: e.text,
          code: e.rule,
        })),
      }
    },

    toJsonSchema(options) {
      return schema.toJSON({ dialect: options?.target ?? 'draft-2020-12' })
    },

    _raw: schema,
  }
}
```

`safeParse()` must be synchronous. `toJsonSchema()` receives `{ target?, io? }` — Swagger passes `target: 'openapi-3.0'` and `io: 'input'` for request schemas.

Register it so auto-detection picks it up:

```ts
import { registerAdapter } from '@forinda/kickjs-schema'

registerAdapter({
  name: 'my-library',
  detect: (schema) => schema instanceof MyLibrarySchema,
  // detect() isn't a type guard, so wrap() receives `unknown` — cast it.
  wrap: (schema) => fromMyLibrary(schema as MyLibrarySchema<unknown>),
})
```

Registration is global and append-only (there is no unregister), so do it once at startup, before `bootstrap()`. It applies everywhere `detectSchema()` runs: `validate()` and route decorators, `loadEnvFromSchema()`, and Swagger.
