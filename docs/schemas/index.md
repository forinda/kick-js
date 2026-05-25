# Schema Abstraction (RFC)

KickJS ships with Zod as the default validation library, but the framework is designed to be **schema-agnostic**. This reference documents the industry standards, the interfaces involved, and how KickJS will support any validation library going forward.

## Why Schema-Agnostic?

Tying a framework to a single schema library means:

- Users inherit that library's bundle size, API style, and release cadence
- Switching libraries requires rewriting every DTO, not just swapping an import
- Community innovation (Valibot's 1 kB tree-shaking, ArkType's 100x perf, TypeBox's native JSON Schema) can't be leveraged

The goal: **users pick their schema library; the framework adapts.**

## Standard Schema v1 (Industry Standard)

[Standard Schema](https://github.com/standard-schema/standard-schema) is a ~60-line TypeScript interface spec created by the maintainers of Zod, Valibot, and ArkType. It solves the N x M problem (N validators x M consumers) by defining one universal contract.

### The Interface

```ts
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>
    readonly types?: { readonly input: Input; readonly output: Output }
  }
}

type Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<Issue> }

interface Issue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
}
```

### Adoption Status

**Schema libraries implementing Standard Schema:**

| Library       | Version               | Bundle | Notes                                 |
| ------------- | --------------------- | ------ | ------------------------------------- |
| Zod           | v3.23+ (native in v4) | ~13 kB | Most popular, `.toJSONSchema()` in v4 |
| Valibot       | v1+                   | ~1 kB  | Tree-shakable, modular                |
| ArkType       | v2+                   | ~5 kB  | Fastest runtime validation            |
| Effect Schema | via adapter           | ~20 kB | Bidirectional encode/decode           |
| TypeBox       | community adapter     | ~8 kB  | Schemas ARE JSON Schema at runtime    |

**Frameworks consuming Standard Schema:**

| Consumer        | Version                               | Integration                      |
| --------------- | ------------------------------------- | -------------------------------- |
| tRPC            | v11                                   | Input/output validators          |
| Hono            | `@hono/standard-validator`            | Middleware validators            |
| React Hook Form | `@hookform/resolvers/standard-schema` | Form validation                  |
| TanStack Form   | v1+                                   | Field validators                 |
| TanStack Router | v1+                                   | Search param validation          |
| oRPC            | v1                                    | Full-stack type safety + OpenAPI |
| Drizzle ORM     | proposed                              | Insert/select schemas            |

### Standard JSON Schema (for OpenAPI)

A companion spec for JSON Schema generation:

```ts
interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => any
    readonly jsonSchema: {
      input(options?: {
        target?: 'draft-2020-12' | 'draft-07' | 'openapi-3.0'
      }): Record<string, unknown>
      output(options?: {
        target?: 'draft-2020-12' | 'draft-07' | 'openapi-3.0'
      }): Record<string, unknown>
    }
    readonly types?: { readonly input: Input; readonly output: Output }
  }
}
```

## How Other Frameworks Handle This

### tRPC (Duck-Typed Priority Chain)

tRPC accepts schemas via priority-ordered duck-typing:

```ts
// 1. Standard Schema (~standard.validate)
// 2. ZodEsque (.parse() + ._input/_output)
// 3. YupEsque (.validateSync() + __outputType)
// 4. CustomValidator (bare function)
```

Key insight: tRPC does NOT require wrapping. Raw Zod, Valibot, or ArkType schemas work directly because they all implement Standard Schema.

### Hono (Standard Schema Middleware)

```ts
import { sValidator } from '@hono/standard-validator'

// Works with ANY Standard Schema library
app.post('/users', sValidator('json', mySchema), (c) => {
  const data = c.req.valid('json') // fully typed
})
```

Accepts targets: `'json'`, `'query'`, `'param'`, `'header'`, `'cookie'`, `'form'`.

### React Hook Form (Resolver Pattern)

```ts
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

// One resolver for ALL Standard Schema libraries
const form = useForm({
  resolver: standardSchemaResolver(anySchema),
})
```

### Elysia (TypeBox-Only, Deliberate)

Elysia couples to TypeBox deliberately -- schemas ARE JSON Schema at runtime, eliminating any conversion step. This is optimal for performance but sacrifices library choice.

### NestJS (Pipe Pattern)

NestJS is NOT schema-agnostic at the framework level. Each library needs its own `PipeTransform` implementation. No Standard Schema integration exists.

## KickJS Current State

### Already Schema-Agnostic (Duck-Typed)

The `validate()` middleware accepts any object with `.safeParse()`:

```ts
// packages/kickjs/src/http/middleware/validate.ts
interface ValidationSchema {
  body?: any // anything with .safeParse(data)
  query?: any
  params?: any
}
```

Protocol: `.safeParse(data)` returns `{ success: true, data }` or `{ success: false, error: { issues } }`.

### Already Pluggable (Swagger)

The Swagger package has a `SchemaParser` interface:

```ts
// packages/swagger/src/schema-parser.ts
interface SchemaParser {
  readonly name: string
  supports(schema: unknown): boolean
  toJsonSchema(schema: unknown): Record<string, unknown>
}
```

### Still Zod-Coupled (To Fix)

| Integration Point        | Coupling                                          |
| ------------------------ | ------------------------------------------------- |
| MCP tool registration    | Passes raw Zod to SDK, uses `.toJSONSchema()`     |
| Config/env (`defineEnv`) | Uses `z.object()`, `z.infer<T>`, `z.coerce`       |
| Error formatting         | Assumes Zod issue shape `{ path, message, code }` |
| Route type inference     | `Ctx<>` relies on Zod-style `_output` type        |

## Proposed KickJS Schema Interface

### Core Types (`@forinda/kickjs-schema`)

```ts
interface KickSchema<TOutput = unknown, TInput = unknown> {
  /** Validate input -- return typed output or structured errors */
  safeParse(data: TInput): SchemaResult<TOutput>

  /** Convert to JSON Schema (for Swagger, MCP, AI tools) */
  toJsonSchema(options?: { target?: 'draft-2020-12' | 'openapi-3.0' }): JsonSchema

  /** Original schema for SDK passthrough (MCP SDK expects raw Zod) */
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

### Adapters

```ts
import { fromZod } from '@forinda/kickjs-schema/zod'
import { fromYup } from '@forinda/kickjs-schema/yup'
import { fromValibot } from '@forinda/kickjs-schema/valibot'
import { fromJoi } from '@forinda/kickjs-schema/joi'
import { fromStandard } from '@forinda/kickjs-schema/standard'

// Wrap once, use everywhere
const CreateUser = fromZod(z.object({ name: z.string() }))
const CreateUser = fromValibot(v.object({ name: v.string() }))
const CreateUser = fromStandard(anyStandardSchemaV1Object)
```

### Type Inference

Each adapter preserves full type inference:

```ts
function fromZod<T extends z.ZodType>(schema: T): KickSchema<z.infer<T>>
function fromYup<T extends yup.Schema>(schema: T): KickSchema<yup.InferType<T>>
function fromValibot<T extends v.BaseSchema>(schema: T): KickSchema<v.InferOutput<T>>
function fromStandard<T extends StandardSchemaV1>(
  schema: T,
): KickSchema<StandardSchemaV1.InferOutput<T>>
```

### Error Normalization

All adapters normalize errors to `SchemaIssue[]`:

```ts
// Zod:  error.issues[].path → string[], error.issues[].message, error.issues[].code
// Yup:  error.inner[].path → split('.'), error.inner[].message, error.inner[].type
// Joi:  error.details[].path → string[], error.details[].message, error.details[].type
// Valibot: issues[].path[].key → string[], issues[].message, issues[].type
// Standard Schema: issues[].path → mapped, issues[].message, code = 'validation'
```

HTTP response always:

```json
{
  "status": 422,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "Invalid email", "code": "pattern" },
    { "field": "age", "message": "Must be >= 18", "code": "min" }
  ]
}
```

### Custom Error Formatter

```ts
bootstrap({
  validation: {
    formatError: (issues: SchemaIssue[]) => ({
      type: 'https://api.example.com/problems/validation',
      title: 'Validation Error',
      violations: issues.map((i) => ({ property: i.path.join('.'), message: i.message })),
    }),
  },
})
```

## Integration Map

| Integration Point       | Current                           | After                                                  |
| ----------------------- | --------------------------------- | ------------------------------------------------------ |
| `validate()` middleware | Duck-types `.safeParse()`         | Accepts `KickSchema` or `StandardSchemaV1`             |
| Route decorators        | `@Post('/', { body: zodSchema })` | `@Post('/', { body: KickSchema \| StandardSchemaV1 })` |
| Swagger/OpenAPI         | `SchemaParser` interface          | Calls `schema.toJsonSchema()` directly                 |
| MCP tool registration   | `zodToJsonSchema()` + raw Zod     | `schema.toJsonSchema()` + `schema._raw` fallback       |
| Config/env              | Deep Zod (keep internally)        | `defineEnv()` stays Zod (framework plumbing)           |
| Error handler           | Assumes Zod issue shape           | Reads normalized `SchemaIssue[]`                       |

## Package Structure

```
packages/schema/
  src/
    types.ts              # KickSchema, SchemaResult, SchemaIssue
    standard.ts           # fromStandard() — wraps StandardSchemaV1
    auto-detect.ts        # Given unknown schema, detect + wrap
    adapters/
      zod.ts             # fromZod()
      yup.ts             # fromYup()
      valibot.ts         # fromValibot()
      joi.ts             # fromJoi()
    json-schema.ts        # JsonSchema type definition
    error-formatter.ts    # Default + pluggable formatting
```

Separate export paths for tree-shaking:

```json
{
  "exports": {
    ".": "./src/types.ts",
    "./zod": "./src/adapters/zod.ts",
    "./yup": "./src/adapters/yup.ts",
    "./valibot": "./src/adapters/valibot.ts",
    "./joi": "./src/adapters/joi.ts",
    "./standard": "./src/standard.ts"
  }
}
```

## Migration Path (Non-Breaking)

1. **Raw Zod schemas continue to work** -- auto-detect wraps them transparently
2. **`SchemaParser` deprecated** -- `schema.toJsonSchema()` replaces it
3. **MCP SDK passthrough** uses `schema._raw` when Zod, falls back to JSON Schema
4. **No breaking changes** -- existing apps upgrading to v5.x need zero modifications

## Decision: Standard Schema vs Custom Interface

| Approach                          | Pros                                                                 | Cons                                                                         |
| --------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Accept Standard Schema directly   | Zero wrapping for Zod/Valibot/ArkType, industry standard             | No JSON Schema in base spec (need companion spec), no `code` field on issues |
| Custom `KickSchema` with adapters | Richer error info, JSON Schema built-in                              | Users must wrap schemas                                                      |
| Both (recommended)                | Best DX -- unwrapped Standard Schema works, adapters add JSON Schema | Slightly more code                                                           |

**Recommendation**: Accept both. If a schema has `~standard`, use it directly. If it also has `.toJsonSchema()` (KickSchema adapter or StandardJSONSchemaV1), use that for OpenAPI. Fallback: auto-detect Zod/Yup/Joi via duck-typing for backwards compat.

## References

- [Standard Schema Spec](https://github.com/standard-schema/standard-schema)
- [Standard Schema Docs](https://standardschema.dev)
- [tRPC Validators](https://trpc.io/docs/server/validators)
- [Hono Standard Validator](https://www.npmjs.com/package/@hono/standard-validator)
- [React Hook Form Resolvers](https://github.com/react-hook-form/resolvers)
- [Valibot v1](https://valibot.dev)
- [ArkType](https://arktype.io)
- [TypeBox](https://github.com/sinclairzx81/typebox)
- [Effect Schema](https://effect.website/docs/schema/introduction)
- [oRPC](https://orpc.dev)
