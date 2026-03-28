# @forinda/kickjs-swagger

Auto-generates an OpenAPI 3.0.3 spec from controller decorators and serves Swagger UI and ReDoc.

## SwaggerAdapter

Application adapter that collects route metadata during mount and serves documentation endpoints.

```typescript
class SwaggerAdapter implements AppAdapter {
  constructor(options?: SwaggerAdapterOptions)
  onRouteMount(controllerClass: any, mountPath: string): void
  beforeMount({ app }: AdapterContext): void
}

interface SwaggerAdapterOptions extends SwaggerOptions {
  docsPath?: string     // default: '/docs'
  redocPath?: string    // default: '/redoc'
  specPath?: string     // default: '/openapi.json'
}
```

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
  summary?: string; description?: string; operationId?: string; deprecated?: boolean
}
```

### ApiResponse

Document a response status code. Can be stacked multiple times on the same method.

```typescript
function ApiResponse(options: ApiResponseOptions): MethodDecorator

interface ApiResponseOptions {
  status: number; description?: string; schema?: any
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

### ApiExclude

Exclude a controller or method from the generated OpenAPI spec.

```typescript
function ApiExclude(): ClassDecorator & MethodDecorator
```

## Types

```typescript
interface OpenAPIInfo { title: string; version: string; description?: string }

interface SwaggerOptions {
  info?: Partial<OpenAPIInfo>
  servers?: { url: string; description?: string }[]
  bearerAuth?: boolean
  schemaParser?: SchemaParser
}
```

## UI Generators

```typescript
function swaggerUIHtml(specPath: string, title?: string): string
function redocHtml(specPath: string, title?: string): string
```
