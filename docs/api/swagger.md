# @forinda/kickjs-swagger

Auto-generates an OpenAPI 3.0.3 spec from controller decorators and serves Swagger UI and ReDoc.

## SwaggerAdapter

Application adapter that collects route metadata during mount and serves documentation endpoints.

```typescript
const SwaggerAdapter: AdapterFactory<SwaggerAdapterOptions>

interface SwaggerAdapterOptions extends SwaggerOptions {
  docsPath?: string // default: '/docs'
  redocPath?: string // default: '/redoc'
  specPath?: string // default: '/openapi.json'
  adapters?: any[] // peer adapters to discover (e.g. WsAdapter)
  disableInProd?: boolean // skip mounting when NODE_ENV === 'production'
  renderSwaggerUI?: UIRenderer // swap the Swagger UI shell
  renderReDoc?: UIRenderer // swap the ReDoc shell
}
```

`SwaggerAdapterOptions` extends [`SwaggerOptions`](#types).

### Marking endpoints public from route flags

`publicFlag` names the [route flag](../guide/route-flags.md) your app already uses
for open endpoints, so the spec reads the same declaration the runtime does
instead of a second annotation that can drift from it:

```ts
SwaggerAdapter({ bearerAuth: true, publicFlag: 'auth.public' })
SwaggerAdapter({ bearerAuth: true, publicFlag: ['auth.public', 'health.probe'] })
```

Resolution order per route: `@ApiPublic` → `securityResolver()` → `publicFlag` →
`bearerAuth`. The name is configuration because the framework names no flags.

For anything richer than a name — a flag's value, two flags combined — use
`securityResolver` with `getRouteFlags`, which resolves method, class **and**
mount declarations:

```ts
import { getRouteFlags } from '@forinda/kickjs'

SwaggerAdapter({
  bearerAuth: true,
  securityResolver: ({ controllerClass, handlerName }) =>
    getRouteFlags(controllerClass, handlerName).has('auth.public') ? null : undefined,
})
```

Because mount flags resolve here too, `bootstrap({ health: { flags: ['auth.public'] } })`
marks both health probes public in the spec with no extra wiring.

Built with `defineAdapter()` — call it as `SwaggerAdapter({ … })` and pass the result to `bootstrap({ adapters: [...] })`. The factory wires `onRouteMount` (route metadata collection) and `beforeMount` (mount the docs UI) internally.

## SchemaParser

Pluggable interface for converting validation library schemas to JSON Schema.

```typescript
interface SchemaParser {
  readonly name: string
  supports(schema: unknown): boolean
  toJsonSchema(schema: unknown): Record<string, unknown>
}
```

## zodSchemaParser

Default schema parser for Zod v4+. Uses Zod's built-in `.toJSONSchema()` method.

```typescript
const zodSchemaParser: SchemaParser
```

## buildOpenAPISpec

Build a complete OpenAPI 3.0.3 spec object from all registered controllers and their decorator metadata.

```typescript
function buildOpenAPISpec(options?: SwaggerOptions): any
```

## registerControllerForDocs

Register a controller class for OpenAPI introspection. Called automatically by `Application` during route mounting.

```typescript
function registerControllerForDocs(controllerClass: any, mountPath: string): void
```

## clearRegisteredRoutes

Clear all registered route metadata. Called on HMR rebuild.

```typescript
function clearRegisteredRoutes(): void
```

## Decorators

### ApiOperation

Attach operation metadata (summary, description, operationId) to a route handler.

```typescript
function ApiOperation(options: ApiOperationOptions): MethodDecorator

interface ApiOperationOptions {
  summary?: string
  description?: string
  operationId?: string
  deprecated?: boolean
}
```

### ApiResponse

Document a response status code. Can be stacked multiple times on the same method.

```typescript
function ApiResponse(options: ApiResponseOptions): MethodDecorator

interface ApiResponseOptions {
  status: number
  description?: string
  schema?: any
}
```

### ApiTags

Apply OpenAPI tags at class or method level.

```typescript
function ApiTags(...tags: string[]): ClassDecorator & MethodDecorator
```

### ApiBearerAuth

Mark an endpoint or controller as requiring Bearer token authentication.

```typescript
function ApiBearerAuth(name?: string): ClassDecorator & MethodDecorator
```

### ApiSecurity

Require a named security scheme on an endpoint or controller. Accepts a scheme
name, a `{ name, scopes }` requirement, or a list of either.

```typescript
function ApiSecurity(
  requirement: string | ApiSecurityRequirement | (string | ApiSecurityRequirement)[],
): ClassDecorator & MethodDecorator
```

A method-level requirement replaces the class-level one rather than adding to
it. Reference a scheme declared in [`securitySchemes`](#swaggeradapter); only
the literal name `BearerAuth` is auto-synthesised.

### ApiPublic

Mark a single method as public — it opts out of any class-level requirement.

```typescript
function ApiPublic(): MethodDecorator
```

Method-only, and the highest-precedence answer in the [resolution
order](../guide/swagger.md#resolution-order). When the spec carries a global
requirement (`bearerAuth: true`), the operation emits `security: []`, which is
how OpenAPI spells "this one is open" — omitting the key would mean "inherit the
global requirement".

### ApiExclude

Exclude a controller or method from the generated OpenAPI spec.

```typescript
function ApiExclude(): ClassDecorator & MethodDecorator
```

## Types

```typescript
interface OpenAPIInfo {
  title: string
  version: string
  description?: string
}

interface SecurityResolverContext {
  controllerClass: any
  handlerName: string
}

interface ApiSecurityRequirement {
  name: string
  scopes?: string[]
}

/** Renders the HTML for a docs UI — `swaggerUIHtml` and `redocHtml` implement it. */
type UIRenderer = (specUrl: string, title?: string, assetsPath?: string) => string

interface SwaggerOptions {
  info?: Partial<OpenAPIInfo>
  servers?: { url: string; description?: string }[]
  /** Add the `BearerAuth` scheme and apply it as a GLOBAL security requirement. */
  bearerAuth?: boolean
  /** Route flag(s) naming a public endpoint — those routes emit `security: []`. */
  publicFlag?: string | readonly string[]
  /** Full control: `null` is public, `undefined` falls through, anything else sets the requirement. */
  securityResolver?: (
    ctx: SecurityResolverContext,
  ) => string | ApiSecurityRequirement | (string | ApiSecurityRequirement)[] | null | undefined
  securitySchemes?: Record<string, OpenAPISecurityScheme>
  schemaParser?: SchemaParser
}
```

## UI Generators

```typescript
function swaggerUIHtml(specPath: string, title?: string): string
function redocHtml(specPath: string, title?: string): string
```
