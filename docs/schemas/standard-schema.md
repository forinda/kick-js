# Standard Schema v1

The industry-standard interface for schema interoperability. Created by the maintainers of Zod, Valibot, and ArkType.

## Spec

```ts
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>
}

namespace StandardSchemaV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>
    readonly types?: Types<Input, Output> | undefined
  }

  type Result<Output> = SuccessResult<Output> | FailureResult

  interface SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
  }

  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
  }

  interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined
  }

  interface PathSegment {
    readonly key: PropertyKey
  }

  interface Types<Input = unknown, Output = Input> {
    readonly input: Input
    readonly output: Output
  }
}
```

## Key Design Decisions

1. **`~standard` namespace key** -- uses `~` prefix to avoid conflicts with user-facing properties (tilde sorts last alphabetically, unlikely to collide)
2. **Sync or async** -- `validate` may return a `Promise` for async validation (e.g., checking uniqueness in a database)
3. **Types are phantom** -- the `types` property is never populated at runtime; it exists only for TypeScript inference via conditional types
4. **Path segments** -- can be `PropertyKey` (string/number/symbol) or `{ key: PropertyKey }` for richer metadata

## Type Inference

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec'

type InferInput<T> = T extends StandardSchemaV1<infer I, any> ? I : never
type InferOutput<T> = T extends StandardSchemaV1<any, infer O> ? O : never
```

## Implementing Standard Schema (for library authors)

```ts
class MySchema<T> implements StandardSchemaV1<unknown, T> {
  readonly '~standard' = {
    version: 1 as const,
    vendor: 'my-library',
    validate: (value: unknown) => {
      const result = this.internalValidate(value)
      if (result.ok) return { value: result.data }
      return {
        issues: result.errors.map((e) => ({
          message: e.message,
          path: e.path,
        })),
      }
    },
    types: undefined as unknown as { input: unknown; output: T },
  }
}
```

## Standard JSON Schema (Companion Spec)

For OpenAPI/Swagger integration, the companion spec adds JSON Schema conversion:

```ts
interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => any
    readonly jsonSchema: {
      input(options?: JsonSchemaOptions): Record<string, unknown>
      output(options?: JsonSchemaOptions): Record<string, unknown>
    }
    readonly types?: { readonly input: Input; readonly output: Output }
  }
}

interface JsonSchemaOptions {
  readonly target?: 'draft-2020-12' | 'draft-07' | 'openapi-3.0'
}
```

The `target` option ensures correct output for different consumers:

- `draft-2020-12` -- modern JSON Schema (default)
- `draft-07` -- legacy tooling (Ajv, older OpenAPI generators)
- `openapi-3.0` -- OpenAPI 3.0 compatible subset (no `$defs`, uses `nullable`)

## Library Support Matrix

| Library       | Standard Schema             | Standard JSON Schema             | Install             |
| ------------- | --------------------------- | -------------------------------- | ------------------- |
| Zod v4        | Native                      | Native (`.toJSONSchema()`)       | `zod`               |
| Zod v3.23+    | Native                      | Via `zod-to-json-schema`         | `zod`               |
| Valibot v1    | Native                      | `@valibot/to-json-schema`        | `valibot`           |
| ArkType v2    | Native                      | Native                           | `arktype`           |
| Effect Schema | `Schema.standardSchemaV1()` | `JSONSchema.make()`              | `effect`            |
| TypeBox       | Community adapter           | Native (schemas ARE JSON Schema) | `@sinclair/typebox` |
| Yup           | Not yet                     | Via `@sodaru/yup-to-json-schema` | `yup`               |
| Joi           | Not yet                     | Via `joi-to-json`                | `joi`               |

## References

- [GitHub Repository](https://github.com/standard-schema/standard-schema)
- [Documentation](https://standardschema.dev)
- [npm: @standard-schema/spec](https://www.npmjs.com/package/@standard-schema/spec)
