# Swagger / OpenAPI

KickJS auto-generates OpenAPI 3.0.3 specs from your decorators and validation schemas. Swagger UI and ReDoc are served automatically.

## Setup

```typescript
import { SwaggerAdapter } from '@forinda/kickjs-swagger'

bootstrap({
  modules,
  adapters: [
    new SwaggerAdapter({
      info: {
        title: 'My API',
        version: '1.0.0',
        description: 'API description',
      },
      servers: [
        { url: 'http://localhost:3000', description: 'Local' },
      ],
      bearerAuth: true,
    }),
  ],
})
```

Visit:
- `http://localhost:3000/docs` — Swagger UI
- `http://localhost:3000/redoc` — ReDoc
- `http://localhost:3000/openapi.json` — Raw JSON spec

## Decorators

### @ApiTags

Tag controllers or methods for grouping in the docs.

```typescript
@Controller()
@ApiTags('Users')
export class UserController {
  @Get('/')
  @ApiTags('Admin')  // method-level overrides class-level
  async listAdmin(ctx: RequestContext) { }
}
```

### @ApiOperation

Describe an endpoint.

```typescript
@Post('/')
@ApiOperation({
  summary: 'Create a user',
  description: 'Longer description with markdown support.',
  operationId: 'createUser',
  deprecated: false,
})
```

### @ApiResponse

Document response statuses. Stackable — add multiple for different status codes.

```typescript
@Post('/')
@ApiResponse({ status: 201, description: 'Created', schema: userResponseSchema, name: 'UserResponse' })
@ApiResponse({ status: 422, description: 'Validation error' })
@ApiResponse({ status: 409, description: 'Already exists' })
```

When you pass a Zod (or Joi) schema, it's converted to JSON Schema and registered in `components/schemas`.

**Schema naming:** Use `name` to control the schema name in the Models section. If omitted, it's auto-generated from the handler name (e.g., `createResponse201`).

```typescript
// Explicit name — appears as "UserResponse" in Models
@ApiResponse({ status: 200, schema: userSchema, name: 'UserResponse' })

// Auto-generated name — appears as "getUserResponse200"
@ApiResponse({ status: 200, schema: userSchema })
```

### @ApiBearerAuth

Mark endpoints as requiring authentication.

```typescript
@Controller()
@ApiBearerAuth()  // applies to all methods
export class AdminController { }
```

### @ApiExclude

Hide a controller or method from the spec.

```typescript
@Get('/internal')
@ApiExclude()
async internal(ctx: RequestContext) { }
```

## Schema-Driven Documentation

Zod schemas passed to route decorators automatically appear in the OpenAPI spec.

### Request Body

```typescript
const createUserSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  role: z.enum(['user', 'admin']),
  tags: z.array(z.string()).max(10).optional(),
})

@Post('/', { body: createUserSchema, name: 'CreateUserRequest' })
```

This generates:
- A request body schema with all field types, constraints, and enums
- A model named `CreateUserRequest` in the "Schemas" section of Swagger UI

**Schema naming:** Use `name` in the validation config to control the request body schema name. If omitted, it's auto-generated from the handler name (e.g., `createBody`).

```typescript
// Explicit name — appears as "CreateUserRequest" in Models
@Post('/', { body: createUserSchema, name: 'CreateUserRequest' })

// Auto-generated name — appears as "createBody"
@Post('/', { body: createUserSchema })
```

### Query Parameters

```typescript
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().max(100).default(20),
  role: z.enum(['user', 'admin']).optional(),
})

@Get('/', { query: listQuerySchema })
```

### Path Parameters

```typescript
@Get('/:id', { params: z.object({ id: z.string().uuid() }) })
```

### Response Schemas

```typescript
const userResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  createdAt: z.string(),
})

@ApiResponse({ status: 200, schema: userResponse, name: 'UserResponse' })
```

## Custom Schema Parser

By default, KickJS converts Zod schemas to JSON Schema. To use a different validation library, implement the `SchemaParser` interface.

### Interface

```typescript
interface SchemaParser {
  readonly name: string
  supports(schema: unknown): boolean
  toJsonSchema(schema: unknown): Record<string, unknown>
}
```

### Joi Example

```typescript
import Joi from 'joi'
import joiToJson from 'joi-to-json'
import type { SchemaParser } from '@forinda/kickjs-swagger'

export const joiSchemaParser: SchemaParser = {
  name: 'joi',

  supports(schema: unknown): boolean {
    return Joi.isSchema(schema)
  },

  toJsonSchema(schema: unknown): Record<string, unknown> {
    const result = joiToJson(schema as Joi.Schema)
    delete result.$schema
    return result
  },
}
```

Pass it to the adapter:

```typescript
new SwaggerAdapter({
  info: { title: 'My API', version: '1.0.0' },
  schemaParser: joiSchemaParser,
})
```

### Yup Example

```typescript
import * as yup from 'yup'
import { convertSchema } from '@sodaru/yup-to-json-schema'
import type { SchemaParser } from '@forinda/kickjs-swagger'

export const yupSchemaParser: SchemaParser = {
  name: 'yup',

  supports(schema: unknown): boolean {
    return schema instanceof yup.Schema
  },

  toJsonSchema(schema: unknown): Record<string, unknown> {
    return convertSchema(schema as yup.Schema)
  },
}
```

### Valibot Example

```typescript
import * as v from 'valibot'
import { toJsonSchema } from '@valibot/to-json-schema'
import type { SchemaParser } from '@forinda/kickjs-swagger'

export const valibotSchemaParser: SchemaParser = {
  name: 'valibot',

  supports(schema: unknown): boolean {
    return typeof schema === 'object' && schema !== null && '_run' in schema
  },

  toJsonSchema(schema: unknown): Record<string, unknown> {
    return toJsonSchema(schema as v.GenericSchema)
  },
}
```

### Using Joi Schemas with Validation

Since the built-in `validate()` middleware uses Zod's `.safeParse()`, you need a custom validation middleware for Joi:

```typescript
import type { Request, Response, NextFunction } from 'express'
import type Joi from 'joi'

export function joiValidate(schema: { body?: Joi.Schema }) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (schema.body) {
      const { error, value } = schema.body.validate(req.body, { abortEarly: false })
      if (error) {
        return res.status(422).json({
          message: error.details[0]?.message || 'Validation failed',
          errors: error.details.map((d) => ({
            field: d.path.join('.'),
            message: d.message,
          })),
        })
      }
      req.body = value
    }
    next()
  }
}
```

Use it with the `@Middleware` decorator:

```typescript
@Post('/')
@Middleware(joiValidate({ body: createTaskSchema }))
@ApiResponse({ status: 201, schema: taskResponseSchema, name: 'TaskResponse' })
async create(ctx: RequestContext) {
  ctx.created(ctx.body)
}
```

## Configuration Options

```typescript
new SwaggerAdapter({
  info: { title, version, description },
  servers: [{ url, description }],
  bearerAuth: true,           // Add global BearerAuth security scheme
  schemaParser: zodSchemaParser, // Default — or pass your custom parser
  docsPath: '/docs',          // Swagger UI path (default: '/docs')
  redocPath: '/redoc',        // ReDoc path (default: '/redoc')
  specPath: '/openapi.json',  // JSON spec path (default: '/openapi.json')
  disableInProd: true,        // Skip mounting docs/spec/assets when NODE_ENV=production
})
```

### Disabling docs in production

Set `disableInProd: true` to keep API docs out of production builds without
conditionally constructing the adapter. When `NODE_ENV === 'production'`, the
adapter becomes a no-op:

- `/docs`, `/redoc`, and `/openapi.json` are not mounted
- Controller route metadata is not collected
- Server URL auto-discovery is skipped

```typescript
new SwaggerAdapter({
  info: { title: 'My API', version: '1.0.0' },
  disableInProd: true,
})
```

In every other environment (`development`, `test`, unset, etc.) the adapter
behaves normally.

### CSP and "Try it out"

The adapter sets a relaxed CSP on its routes so Swagger UI's "Try it out"
button works across common dev origins. `connect-src` includes `'self'`,
`http(s)://localhost:*`, `http(s)://127.0.0.1:*`, `ws://localhost:*`,
`ws://127.0.0.1:*`, plus the origin of every URL in `options.servers`. If you
serve docs from a custom host in production, add it via `servers` and it will
be allowed automatically.

## Examples

| Example | What it shows |
|---------|---------------|
| [swagger-api](../examples/swagger-api) | Rich Zod schemas: nested objects, arrays, enums, UUID, datetime, regex, partial, paginated responses |
| [joi-api](../examples/joi-api) | Custom `joiSchemaParser`, Joi validation middleware, Joi schemas in Swagger |
| [validated-api](../examples/validated-api) | Query parsing with `ctx.qs()` + Swagger decorators |
