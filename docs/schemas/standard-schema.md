# Standard Schema v1

[Standard Schema](https://standardschema.dev) is a small TypeScript interface that the authors of Zod, Valibot and ArkType wrote together. A library that implements it can be consumed by any tool that reads it, without a library-specific adapter. KickJS is one of those tools: `detectSchema()` accepts any Standard Schema v1 object, so libraries without a built-in adapter, such as ArkType, work without wrapping.

## Spec

The types ship in the [`@standard-schema/spec`](https://www.npmjs.com/package/@standard-schema/spec) package:

```ts
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>
}

declare namespace StandardSchemaV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
      options?: Options | undefined,
    ) => Result<Output> | Promise<Result<Output>>
    readonly types?: Types<Input, Output> | undefined
  }

  interface Options {
    readonly libraryOptions?: Record<string, unknown> | undefined
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

## Key design decisions

1. **The `~standard` key.** The `~` prefix keeps it out of the way of a library's own API, and it sorts last in autocomplete.
2. **Sync or async.** `validate` may return a `Promise`, for checks such as uniqueness in a database.
3. **Phantom types.** `types` exists only for TypeScript inference. Libraries don't have to fill it in at runtime.
4. **Path segments.** A path segment is either a `PropertyKey` (string, number or symbol) or `{ key: PropertyKey }`.

## Type inference

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec'

type InferInput<T> = T extends StandardSchemaV1<infer I, unknown> ? I : never
type InferOutput<T> = T extends StandardSchemaV1<unknown, infer O> ? O : never
```

The spec package also ships these as `StandardSchemaV1.InferInput<T>` and `StandardSchemaV1.InferOutput<T>`. KickJS's own `InferSchemaOutput<T>` reads `~standard.types.output` before falling back to library-specific brands, so `kick typegen` types routes from any Standard Schema.

## Implementing Standard Schema

Here is a sketch for library authors. A real library would validate more than one type:

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec'

class StringSchema implements StandardSchemaV1<unknown, string> {
  readonly '~standard': StandardSchemaV1.Props<unknown, string> = {
    version: 1,
    vendor: 'my-library',
    validate: (value) =>
      typeof value === 'string'
        ? { value }
        : { issues: [{ message: `Expected a string, received ${typeof value}` }] },
  }
}
```

## Standard JSON Schema (companion spec)

A companion interface lets a library describe its schemas as JSON Schema. It is separate from validation. A library that offers both implements both, and the spec names the combination `StandardSchemaWithJSON`:

```ts
interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardJSONSchemaV1.Props<Input, Output>
}

declare namespace StandardJSONSchemaV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1
    readonly vendor: string
    readonly types?: { readonly input: Input; readonly output: Output } | undefined
    readonly jsonSchema: Converter
  }

  interface Converter {
    /** May throw if the library can't convert the schema. */
    readonly input: (options: Options) => Record<string, unknown>
    readonly output: (options: Options) => Record<string, unknown>
  }

  type Target = 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | ({} & string)

  interface Options {
    /** Required. A library should throw for a target it doesn't support. */
    readonly target: Target
    readonly libraryOptions?: Record<string, unknown> | undefined
  }
}

/** Validation and JSON Schema on one object. */
interface StandardSchemaWithJSON<Input = unknown, Output = Input> {
  '~standard': StandardSchemaV1.Props<Input, Output> & StandardJSONSchemaV1.Props<Input, Output>
}
```

`target` is required, so the spec has no default:

- `draft-2020-12`: current JSON Schema
- `draft-07`: older tooling
- `openapi-3.0`: the OpenAPI 3.0 dialect, a superset of draft-04 that uses `nullable`

`input` describes what the schema accepts, and `output` describes what it produces. They differ for defaults, coercion and transforms.

## How KickJS reads a Standard Schema

`detectSchema()` checks for its built-in Zod, Valibot and Yup adapters first. Any other object or function with a `~standard` property goes through the generic Standard Schema wrapper. Functions count because ArkType types are callable.

- **Validation:** `safeParse()` calls `~standard.validate(value)`. Each issue becomes a `SchemaIssue` whose `path` is the path segments converted to strings (`[{ key: 'tags' }, 0]` becomes `['tags', '0']`) and whose `code` is always `'validation'`. The spec has no issue codes.
- **Sync only:** if `validate` returns a `Promise`, `safeParse()` throws. Route validation and env loading run synchronously.
- **JSON Schema:** `toJsonSchema({ target, io })` calls `~standard.jsonSchema.input({ target })` when `io` is `'input'`, and `output({ target })` otherwise. When the caller gives no target, KickJS uses `'draft-2020-12'`. Swagger passes `'openapi-3.0'`, so the library produces the OpenAPI dialect itself. If a library doesn't implement Standard JSON Schema, KickJS tries a `toJSONSchema()` method and otherwise returns `{ type: 'object' }`.

```ts
import { detectSchema } from '@forinda/kickjs-schema'
import type { StandardSchemaV1 } from '@standard-schema/spec'

const positive: StandardSchemaV1<unknown, number> = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate: (value) =>
      typeof value === 'number' && value > 0
        ? { value }
        : { issues: [{ message: 'Expected a positive number' }] },
  },
}

const result = detectSchema(positive).safeParse(-1)
// { success: false, issues: [{ path: [], message: 'Expected a positive number', code: 'validation' }] }
```

## Library support in KickJS

| Library       | Implements Standard Schema    | How KickJS validates it         | How KickJS produces JSON Schema                                                                                               |
| ------------- | ----------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Zod 4         | yes, and Standard JSON Schema | built-in Zod adapter            | Zod's `toJSONSchema()`, with `target` and `io`                                                                                |
| Zod 3 (3.23+) | from 3.24                     | built-in Zod adapter            | none: only `{ type: 'object' }`, because Zod 3 has no `toJSONSchema()`                                                        |
| Valibot 1     | yes                           | built-in Valibot adapter        | `@valibot/to-json-schema` (an optional peer that `kick new` installs); `{ type: 'object' }` and a one-time warning without it |
| Yup 1         | yes (checked on 1.7.1)        | built-in Yup adapter            | KickJS's own converter, built from `describe()`                                                                               |
| ArkType 2     | yes                           | generic Standard Schema wrapper | through Standard JSON Schema, if the installed version implements it                                                          |
| Others        | if they implement it          | generic Standard Schema wrapper | Standard JSON Schema if implemented, otherwise `{ type: 'object' }`                                                           |

Zod, Valibot and Yup use built-in adapters even though they implement Standard Schema. The adapters report `expected` / `received` on issues and keep each library's own issue `code`.

KickJS has no adapter for a library that implements neither Standard Schema nor one of the built-in shapes, such as Joi. Register one with `registerAdapter()`. See [Adding a library](./index.md#adding-a-library).

## References

- [Standard Schema on GitHub](https://github.com/standard-schema/standard-schema)
- [standardschema.dev](https://standardschema.dev)
- [`@standard-schema/spec` on npm](https://www.npmjs.com/package/@standard-schema/spec)
- [Schemas overview](./index.md)
