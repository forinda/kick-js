# Framework Integration Points

How the schema abstraction connects to KickJS's existing systems: HTTP validation, Swagger/OpenAPI, MCP tools, and AI tool definitions.

## HTTP Validation Pipeline

### Current Flow (Zod-Coupled)

```
Route Decorator → validate() middleware → .safeParse() → 422 or next()
```

### Target Flow (Schema-Agnostic)

```
Route Decorator → validate() middleware → detectSchema() → .safeParse() → normalize issues → 422 or next()
```

The `validate()` middleware becomes a thin orchestrator:

```ts
function validate(schemas: ValidationSchema): RequestHandler {
  return (req, res, next) => {
    const targets = [
      { key: 'body', source: req.body, schema: schemas.body },
      { key: 'query', source: req.query, schema: schemas.query },
      { key: 'params', source: req.params, schema: schemas.params },
    ]

    for (const { key, source, schema } of targets) {
      if (!schema) continue

      const wrapped = detectSchema(schema) // auto-detect + wrap
      const result = wrapped.safeParse(source)

      if (!result.success) {
        const message =
          key === 'query'
            ? 'Invalid query parameters'
            : key === 'params'
              ? 'Invalid path parameters'
              : (result.issues[0]?.message ?? 'Validation failed')

        throw HttpException.unprocessable(message, result.issues)
      }

      // Replace raw data with validated + transformed output
      assignValidated(req, key, result.data)
    }
    next()
  }
}
```

## Swagger / OpenAPI Integration

### Current: SchemaParser Interface

```ts
interface SchemaParser {
  readonly name: string
  supports(schema: unknown): boolean
  toJsonSchema(schema: unknown): Record<string, unknown>
}
```

### Target: Direct .toJsonSchema() Call

```ts
function schemaToOpenApi(schema: unknown, target: 'openapi-3.0' = 'openapi-3.0') {
  const wrapped = detectSchema(schema)
  return wrapped.toJsonSchema({ target })
}
```

The Swagger adapter uses this at startup when building the OpenAPI spec:

```ts
// openapi-builder.ts
for (const route of routes) {
  if (route.validation?.body) {
    const jsonSchema = schemaToOpenApi(route.validation.body)
    spec.components.schemas[route.schemaName] = jsonSchema
    // ... wire into requestBody.$ref
  }
}
```

### Schema Name Resolution

For `components/schemas` naming:

1. Explicit: `@Post('/', { body: schema, name: 'CreateUser' })` -- uses provided name
2. Inferred: schema adapter exposes `schema.title` or `schema._raw.description`
3. Fallback: `${ControllerName}_${methodName}_body`

## MCP Tool Registration

### Current Flow

```ts
// mcp.adapter.ts
const jsonSchema = zodToJsonSchema(route.validation?.body) ?? { type: 'object' }
const zodInput = route.validation?.body // raw Zod for SDK

server.registerTool(
  name,
  {
    inputSchema: jsonSchema,
    ...(zodInput ? { config: { inputSchema: zodInput } } : {}),
  },
  handler,
)
```

### Target Flow

```ts
const wrapped = detectSchema(route.validation?.body)
const jsonSchema = wrapped?.toJsonSchema() ?? { type: 'object' }
const rawSchema = wrapped?._raw // for MCP SDK passthrough (expects Zod)

server.registerTool(
  name,
  {
    inputSchema: jsonSchema,
    ...(rawSchema ? { config: { inputSchema: rawSchema } } : {}),
  },
  handler,
)
```

The MCP SDK currently requires a raw Zod schema for its type inference. The `_raw` property preserves this. When the MCP SDK adopts Standard Schema (tracked in their roadmap), the passthrough becomes unnecessary.

## AI Tool Definitions

Same pattern as MCP:

```ts
// ai.adapter.ts
const wrapped = detectSchema(route.validation?.body)
tools.push({
  name: toolName,
  description: meta.description,
  inputSchema: wrapped?.toJsonSchema() ?? { type: 'object', properties: {} },
})
```

## Config / Environment Validation

Config stays Zod-internal. This is framework plumbing, not user-facing validation:

```ts
// Users still write:
export default defineEnv((base) =>
  base.extend({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().optional(),
  }),
)
```

Rationale: env validation runs once at boot, isn't user-facing, and Zod's `.coerce` + `.default()` + `.transform()` features are essential for env parsing. Abstracting this provides no user benefit.

## Type Generation (typegen)

The `kick typegen` command generates a `KickRoutes` namespace for compile-time safety:

```ts
// Generated: src/__generated__/routes.d.ts
declare namespace KickRoutes {
  interface TodoController {
    create: { body: { title: string; priority: 'low' | 'medium' | 'high' } }
  }
}
```

### How It Works with Schema Abstraction

Type generation reads the schemas at build time. For each adapter:

- **Zod**: `z.infer<typeof schema>`
- **Valibot**: `v.InferOutput<typeof schema>`
- **Standard Schema**: `StandardSchemaV1.InferOutput<typeof schema>`

The typegen plugin resolves the output type via the `KickSchema<TOutput>` generic:

```ts
type RouteBody<T> =
  T extends KickSchema<infer O> ? O : T extends StandardSchemaV1<any, infer O> ? O : unknown
```

## RequestContext Typing

With schema abstraction, `ctx.body`, `ctx.query`, `ctx.params` remain fully typed:

```ts
@Post('/', { body: createUserSchema }) // KickSchema<CreateUserDTO>
async create(ctx: RequestContext) {
  ctx.body // CreateUserDTO — typed regardless of library
}
```

The validated data replaces the raw request data after `.safeParse()` succeeds. Since all adapters return the same `{ success: true, data: T }` shape, the type flows through unchanged.

## Migration Checklist

For the schema abstraction to be complete:

- [ ] Create `packages/schema` with core types + adapters
- [ ] Update `validate()` middleware to use `detectSchema()`
- [ ] Update Swagger `openapi-builder.ts` to call `.toJsonSchema()` directly
- [ ] Update MCP `mcp.adapter.ts` to use `detectSchema()` + `._raw`
- [ ] Update AI `ai.adapter.ts` similarly
- [ ] Update error handler to accept normalized `SchemaIssue[]`
- [ ] Add `validation.formatError` option to `bootstrap()`
- [ ] Deprecate `SchemaParser` interface (keep working for 1 minor cycle)
- [ ] Update typegen to resolve types from `KickSchema<T>`
- [ ] Add tests for each adapter
- [ ] Document migration in changelog
