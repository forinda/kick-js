# @forinda/kickjs-schema

Schema-agnostic validation for KickJS. Every schema the framework touches — route `body` / `query` / `params`, env schemas, Swagger, AI and MCP tools — goes through one interface, `KickSchema`, so Zod, Valibot, Yup and any [Standard Schema](https://standardschema.dev) library work the same way.

The [Schema guide](../guide/schema.md) explains adapters and custom libraries in depth; [Validation](../guide/validation.md) shows route-level usage.

## Install

```bash
pnpm add @forinda/kickjs-schema
```

Every validator is an optional peer — install the one you use:

| Peer                      | Range      | Needed for                                  |
| ------------------------- | ---------- | ------------------------------------------- |
| `zod`                     | `>=3.23.0` | Zod schemas                                 |
| `valibot`                 | `>=1.0.0`  | Valibot schemas                             |
| `@valibot/to-json-schema` | `>=1.0.0`  | JSON Schema for Valibot (Swagger, AI tools) |
| `yup`                     | `>=1.0.0`  | Yup schemas                                 |

## Entry points

| Import path                      | Exports                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `@forinda/kickjs-schema`         | Types, `detectSchema`, `isKickSchema`, `registerAdapter`, `buildRouteTool` |
| `@forinda/kickjs-schema/zod`     | `fromZod`, `isZodSchema`, `zodAdapter`                                     |
| `@forinda/kickjs-schema/valibot` | `fromValibot`, `isValibotSchema`, `valibotAdapter`                         |
| `@forinda/kickjs-schema/yup`     | `fromYup`, `isYupSchema`, `yupAdapter`                                     |

You rarely need the subpaths: `detectSchema` recognises Zod, Valibot and Yup schemas without wrapping.

## Types

### KickSchema

The interface every schema is normalised to.

```typescript
interface KickSchema<TOutput = unknown, TInput = unknown> {
  safeParse(data: TInput): SchemaResult<TOutput>
  toJsonSchema(options?: JsonSchemaOptions): Record<string, unknown>
  readonly _raw?: unknown // the original library schema
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

### JsonSchemaOptions

| Field    | Type                                             | Default    | Description                                                                                                               |
| -------- | ------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `target` | `'draft-2020-12' \| 'draft-07' \| 'openapi-3.0'` | library's  | JSON Schema dialect, passed through to the library.                                                                       |
| `io`     | `'input' \| 'output'`                            | `'output'` | Describe what the schema accepts (a request) or produces (a response). They differ for defaults, coercion and transforms. |

The `$schema` key is stripped from the result. For Zod and Valibot, conversion describes what can't be expressed (a `Map`, a transform) as any value instead of throwing; `Date` becomes `{ type: 'string', format: 'date-time' }` and `bigint` becomes `{ type: 'integer' }`. With `io: 'input'`, a non-coerced date or bigint field logs a one-time warning, since JSON can't send one.

### SchemaAdapter

What `registerAdapter` takes.

```typescript
interface SchemaAdapter {
  readonly name: string
  detect(schema: unknown): boolean
  wrap(schema: unknown): KickSchema
}
```

### InferSchemaOutput

The parsed output type of any supported schema. Reads, in order: `KickSchema<O>`, Standard Schema `~standard.types.output`, Zod `~output` / `_output`, Yup `__outputType`; otherwise `unknown`.

```typescript
type InferSchemaOutput<T>
```

```ts
const createUser = z.object({ name: z.string(), age: z.number().optional() })
type CreateUser = InferSchemaOutput<typeof createUser> // { name: string; age?: number }
```

## Functions

### detectSchema

Normalise any supported schema to a `KickSchema`.

```typescript
function detectSchema(schema: unknown): KickSchema
```

Resolution order:

1. Already a `KickSchema` — returned as is.
2. Adapters added with `registerAdapter`, in registration order.
3. Zod, then Valibot, then Yup.
4. A Standard Schema implementer (`~standard`). Async validation throws.
5. A plain function — called with the data; a throw becomes a `custom` issue.
6. Any object with `safeParse()`.

Anything else throws `Unrecognized schema`.

```ts
import { detectSchema } from '@forinda/kickjs-schema'

const result = detectSchema(createUser).safeParse(req.body)
if (!result.success) console.log(result.issues)
```

### isKickSchema

Type guard: `true` for an object with `safeParse` and `toJsonSchema` methods.

```typescript
function isKickSchema(schema: unknown): schema is KickSchema
```

### registerAdapter

Teach `detectSchema` another library. Custom adapters are checked before the built-in ones.

```typescript
function registerAdapter(adapter: SchemaAdapter): void
```

```ts
registerAdapter({
  name: 'joi',
  detect: (s) => Joi.isSchema(s),
  wrap: (s) => wrapJoi(s as Joi.Schema), // your own KickSchema wrapper
})
```

See [Registering a custom adapter](../guide/schema.md#registering-a-custom-adapter) for a complete example.

### buildRouteTool

Build one tool input schema (MCP, LLM function calling) from a route, and the mapping from tool arguments back to a request. Used by `@forinda/kickjs-mcp` and `@forinda/kickjs-ai`.

```typescript
function buildRouteTool(source: RouteToolSource): RouteTool

interface RouteToolSource {
  method: string // any case
  path: string // with :param placeholders
  params?: unknown
  query?: unknown
  body?: unknown
  input?: unknown // replaces the query/body part; path params are still added
}

interface RouteTool {
  inputSchema: Record<string, unknown>
  toRequest(args: Record<string, unknown> | undefined): RouteToolRequest
}

interface RouteToolRequest {
  url: string // path params filled, query string appended
  body?: unknown // POST / PUT / PATCH only
}
```

Path parameters are always required. Body fields (POST / PUT / PATCH) and query fields sit side by side; a non-object body appears as a single `body` property. `toRequest` throws when a path parameter is missing.

```ts
const tool = buildRouteTool({
  method: 'PUT',
  path: '/api/v1/tasks/:id',
  body: z.object({ title: z.string() }),
})
tool.inputSchema // { type: 'object', properties: { id, title }, required: ['id', 'title'] }
tool.toRequest({ id: '42', title: 'Ship' }) // { url: '/api/v1/tasks/42', body: { title: 'Ship' } }
```

## Library adapters

Each subpath exports a wrapper, a detector and a `SchemaAdapter` object. The wrapper infers `TOutput` from the schema.

```typescript
// @forinda/kickjs-schema/zod
function fromZod<TSchema>(schema: TSchema): KickSchema<InferSchemaOutput<TSchema>>
function isZodSchema(schema: unknown): boolean
const zodAdapter: { name: 'zod'; detect: typeof isZodSchema; wrap: typeof fromZod }

// @forinda/kickjs-schema/valibot
function fromValibot<TSchema>(schema: TSchema): KickSchema<InferSchemaOutput<TSchema>>
function isValibotSchema(schema: unknown): boolean
const valibotAdapter: { name: 'valibot'; detect: typeof isValibotSchema; wrap: typeof fromValibot }

// @forinda/kickjs-schema/yup
function fromYup<TSchema>(schema: TSchema): KickSchema<InferSchemaOutput<TSchema>>
function isYupSchema(schema: unknown): boolean
const yupAdapter: { name: 'yup'; detect: typeof isYupSchema; wrap: typeof fromYup }
```

Notes per library:

- **Zod** — JSON Schema comes from Zod's own `toJSONSchema()` (Zod v4). Without it, `{ type: 'object' }`.
- **Valibot** — `valibot` and `@valibot/to-json-schema` are loaded when the package is imported, if installed. `fromValibot` throws when `valibot` is missing. Without the converter every schema is described as `{ type: 'object' }`, with a one-time warning.
- **Yup** — JSON Schema is built from the schema's `describe()` output.

```ts
import { z } from 'zod'
import { fromZod } from '@forinda/kickjs-schema/zod'

const schema = fromZod(z.object({ email: z.string().email() })) // KickSchema<{ email: string }>
schema.toJsonSchema({ io: 'input', target: 'openapi-3.0' })
```

## See also

- [Schema guide](../guide/schema.md)
- [Validation](../guide/validation.md)
- [`@forinda/kickjs-swagger`](./swagger.md) — consumes `toJsonSchema()`
