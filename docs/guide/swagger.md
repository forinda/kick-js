# Swagger / OpenAPI

KickJS auto-generates OpenAPI 3.0.3 specs from your decorators and validation schemas. Swagger UI and ReDoc are served automatically.

## Setup

```typescript
import { SwaggerAdapter } from '@forinda/kickjs-swagger'

bootstrap({
  modules,
  adapters: [
    SwaggerAdapter({
      info: {
        title: 'My API',
        version: '1.0.0',
        description: 'API description',
      },
      servers: [{ url: 'http://localhost:3000', description: 'Local' }],
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
  @ApiTags('Admin') // method-level overrides class-level
  async listAdmin(ctx: RequestContext) {}
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

Mark endpoints as requiring Bearer-token authentication. Convenience over `@ApiSecurity('BearerAuth')` — also auto-synthesizes a bearer-shaped scheme under the given name (defaults to `'BearerAuth'`).

```typescript
@Controller()
@ApiBearerAuth() // applies to all methods
export class AdminController {}

@Controller()
class CustomAuthController {
  @Get('/')
  @ApiBearerAuth('ApiKeyAuth') // custom scheme name; still bearer-shaped
  list() {}
}
```

### @ApiSecurity

Generic security decorator. Pick this when the scheme isn't bearer-shaped (API key, OAuth2 with scopes, OpenID Connect) or when a route accepts multiple alternative schemes.

```typescript
import { ApiSecurity } from '@forinda/kickjs-swagger'

@Controller('/users')
@ApiSecurity('BearerAuth') // class-level default
class UsersController {
  @Get('/me')
  @ApiSecurity({ name: 'OAuth2', scopes: ['users:read'] }) // method override + scopes
  me() {}

  @Get('/multi')
  @ApiSecurity(['BearerAuth', { name: 'ApiKey' }]) // multiple alternatives
  multi() {}
}
```

Three input shapes:

- **String** — `@ApiSecurity('BearerAuth')`. Single scheme, no scopes.
- **Object** — `@ApiSecurity({ name: 'OAuth2', scopes: ['users:read'] })`. Single scheme with OAuth2 / OpenID Connect scopes.
- **Array** — `@ApiSecurity(['BearerAuth', { name: 'ApiKey' }])`. Multiple alternative schemes; clients satisfy any one.

Class-level requirements cascade to every method; method-level requirements override the class default.

::: warning Custom scheme names must be declared
`@ApiSecurity('MyCustomScheme')` references a scheme by name. Unless the name is `'BearerAuth'` (which auto-synthesizes a `bearer` HTTP scheme for back-compat with `@ApiBearerAuth`), the scheme MUST be declared under `SwaggerOptions.securitySchemes` — otherwise the spec emits the requirement but Swagger UI surfaces a "missing scheme" warning.
:::

### @ApiPublic

Mark a single method as publicly accessible — opts out of any class-level security requirement (set via `@ApiSecurity` or `@ApiBearerAuth`).

```typescript
@Controller('/internal')
@ApiSecurity('BearerAuth')
class InternalController {
  @Get('/health')
  @ApiPublic() // overrides class-level BearerAuth — no security on /health
  health() {}
}
```

Use when the controller is mostly secured but exposes a health-check / login / public-stats endpoint that shouldn't carry the inherited security requirement in the OpenAPI spec.

### @ApiExclude

Hide a controller or method from the spec.

```typescript
@Get('/internal')
@ApiExclude()
async internal(ctx: RequestContext) { }
```

## Declaring Security Schemes

Custom OpenAPI security schemes (anything beyond the auto-synthesized `BearerAuth`) live under `SwaggerOptions.securitySchemes`:

```typescript
SwaggerAdapter({
  securitySchemes: {
    OAuth2: {
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token',
          scopes: {
            'users:read': 'Read user profile',
            'users:write': 'Modify user profile',
          },
        },
      },
    },
    ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
  },
})
```

Schemes declared here resolve when referenced by name from `@ApiSecurity('OAuth2')` / `@ApiBearerAuth('ApiKey')` / the `securityResolver` hook below.

## Bridging Other Auth Libraries — `securityResolver`

If your project uses a different auth library and wants its decorators to drive Swagger's security annotations without putting `@ApiSecurity` on every controller, supply a `securityResolver` hook. The hook receives the controller class + method name; return a scheme reference (or `null` to mark the route explicitly public, or `undefined` to fall through to decorator-driven resolution).

```typescript
SwaggerAdapter({
  securityResolver: ({ controllerClass, handlerName }) => {
    // Bridge `@forinda/kickjs-auth`'s metadata without coupling.
    const proto = controllerClass.prototype
    if (Reflect.getMetadata('kick:auth:public', proto, handlerName)) return null
    const secured =
      Reflect.getMetadata('kick:auth:authenticated', controllerClass) ||
      Reflect.getMetadata('kick:auth:authenticated', proto, handlerName)
    return secured ? 'BearerAuth' : undefined
  },
})
```

The resolver runs **after** `@ApiPublic()` (which short-circuits to public) but **before** the decorator-driven `@ApiSecurity` / `@ApiBearerAuth` lookups. Returning a value drives the requirement; returning `null` is "explicitly public" (overrides class-level security); returning `undefined` falls through.

## Resolution order

When the spec builder picks security for a route, the first match wins:

1. `@ApiPublic()` on the method → no security emitted.
2. `securityResolver({ controllerClass, handlerName })` returns a value (or `null` for public).
3. `@ApiSecurity` on the method.
4. `@ApiBearerAuth` on the method.
5. `@ApiSecurity` on the class.
6. `@ApiBearerAuth` on the class.

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
SwaggerAdapter({
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
SwaggerAdapter({
  info: { title, version, description },
  servers: [{ url, description }],
  bearerAuth: true, // Add global BearerAuth security scheme
  schemaParser: zodSchemaParser, // Default — or pass your custom parser
  docsPath: '/docs', // Swagger UI path (default: '/docs')
  redocPath: '/redoc', // ReDoc path (default: '/redoc')
  specPath: '/openapi.json', // JSON spec path (default: '/openapi.json')
  disableInProd: true, // Skip mounting docs/spec/assets when NODE_ENV=production
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
SwaggerAdapter({
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

For a full app exercising Swagger end-to-end with rich Zod schemas, see the [task-drizzle-api](../examples/task-drizzle-api) and [task-prisma-api](../examples/task-prisma-api) examples — they wire Swagger over the standard 14-module DDD layout.
