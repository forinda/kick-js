# Schema Adapters

Each adapter wraps a specific validation library into the unified `KickSchema` interface. Adapters are tree-shakable -- unused libraries add zero bytes to the bundle.

## Zod Adapter

```ts
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

const CreateUser = fromZod(
  z.object({
    name: z.string().min(1),
    email: z.string().email(),
    age: z.number().int().min(18),
  }),
)

// Type inference preserved
type CreateUserInput = typeof CreateUser extends KickSchema<infer T> ? T : never
// { name: string; email: string; age: number }
```

**Validation protocol**: Calls `schema.safeParse(data)`. Returns `{ success: true, data }` or maps `ZodError.issues` to `SchemaIssue[]`.

**JSON Schema**: Uses Zod v4 native `.toJSONSchema()`. For Zod v3, falls back to `zod-to-json-schema`.

**Error mapping**:

```
ZodIssue.path       → SchemaIssue.path (string[])
ZodIssue.message    → SchemaIssue.message
ZodIssue.code       → SchemaIssue.code ("invalid_type", "too_small", etc.)
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

**Validation protocol**: Calls `v.safeParse(schema, data)`. Maps `result.issues` to `SchemaIssue[]`.

**JSON Schema**: Uses `@valibot/to-json-schema` with configurable target (`draft-2020-12`, `openapi-3.0`).

**Error mapping**:

```
issue.path[].key    → SchemaIssue.path (string[])
issue.message       → SchemaIssue.message
issue.type          → SchemaIssue.code ("string", "min_length", etc.)
issue.expected      → SchemaIssue.expected
issue.received      → SchemaIssue.received
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

**Validation protocol**: Calls `schema.validate(data, { abortEarly: false })`. Catches `ValidationError` and maps `error.inner` to `SchemaIssue[]`.

**JSON Schema**: Uses `@sodaru/yup-to-json-schema` or custom walker.

**Error mapping**:

```
inner[].path        → SchemaIssue.path (split on '.')
inner[].message     → SchemaIssue.message
inner[].type        → SchemaIssue.code ("required", "min", "email", etc.)
```

## Joi Adapter

```ts
import { fromJoi } from '@forinda/kickjs-schema/joi'
import Joi from 'joi'

const CreateUser = fromJoi(
  Joi.object({
    name: Joi.string().required().min(1),
    email: Joi.string().required().email(),
    age: Joi.number().required().integer().min(18),
  }),
)
```

**Validation protocol**: Calls `schema.validate(data, { abortEarly: false })`. Maps `error.details` to `SchemaIssue[]`.

**JSON Schema**: Uses `joi-to-json` for conversion.

**Error mapping**:

```
details[].path      → SchemaIssue.path (already string[])
details[].message   → SchemaIssue.message
details[].type      → SchemaIssue.code ("string.min", "any.required", etc.)
```

## Standard Schema Adapter (Universal)

```ts
import { fromStandard } from '@forinda/kickjs-schema/standard'

// Works with ANY library implementing Standard Schema v1
const CreateUser = fromStandard(anyStandardSchemaV1Object)
```

**Validation protocol**: Calls `schema['~standard'].validate(data)`. Maps Standard Schema issues to `SchemaIssue[]`.

**JSON Schema**: Checks for StandardJSONSchemaV1's `~standard.jsonSchema.input()` method. Falls back to empty schema if not available.

**Error mapping**:

```
issue.path          → SchemaIssue.path (mapped from PropertyKey | PathSegment)
issue.message       → SchemaIssue.message
(no code in spec)   → SchemaIssue.code = "validation"
```

## Auto-Detection (Zero-Config)

When a raw schema (not wrapped) is passed to `validate()` or a route decorator, KickJS auto-detects the library:

```ts
function detectSchema(schema: unknown): KickSchema {
  // 1. Already a KickSchema? Return as-is.
  if (isKickSchema(schema)) return schema

  // 2. Standard Schema v1? (~standard property)
  if (hasStandardSchema(schema)) return fromStandard(schema)

  // 3. Zod? (.safeParse + ._def)
  if (isZodLike(schema)) return fromZod(schema)

  // 4. Yup? (.validateSync + .describe)
  if (isYupLike(schema)) return fromYup(schema)

  // 5. Joi? (.validate + .describe + .$_root)
  if (isJoiLike(schema)) return fromJoi(schema)

  // 6. Plain function? Treat as custom validator
  if (typeof schema === 'function') return fromFunction(schema)

  throw new Error('Unrecognized schema. Wrap it with an adapter or implement StandardSchemaV1.')
}
```

Priority order ensures Standard Schema takes precedence (since Zod v4 also implements it, checking `~standard` first avoids double-wrapping).

## Writing a Custom Adapter

For libraries not listed above:

```ts
import type { KickSchema, SchemaResult, SchemaIssue } from '@forinda/kickjs-schema'

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

Register it globally so auto-detection picks it up:

```ts
import { registerAdapter } from '@forinda/kickjs-schema'

registerAdapter({
  name: 'my-library',
  detect: (schema) => schema instanceof MyLibrarySchema,
  wrap: (schema) => fromMyLibrary(schema),
})
```
