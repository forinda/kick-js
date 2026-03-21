# Validation

KickJS validates request data using Zod schemas. Validation can be declared inline on route decorators or applied manually with the `validate()` middleware. Failed validation returns a `422` response with structured error details.

## Inline Validation on Route Decorators

The route decorators (`@Get`, `@Post`, `@Put`, `@Delete`, `@Patch`) accept a second argument with Zod schemas for `body`, `query`, and `params`:

```ts
import { Controller, Post, Put, Get } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'
import { z } from 'zod'

const createTodoSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

const updateTodoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
})

const searchQuerySchema = z.object({
  q: z.string().optional(),
  status: z.enum(['active', 'completed']).optional(),
})

@Controller()
export class TodoController {
  @Post('/', { body: createTodoSchema })
  async create(ctx: RequestContext) {
    // ctx.body is validated and typed
    ctx.created(ctx.body)
  }

  @Put('/:id', { body: updateTodoSchema })
  async update(ctx: RequestContext) {
    ctx.json(ctx.body)
  }

  @Get('/search', { query: searchQuerySchema })
  async search(ctx: RequestContext) {
    ctx.json({ query: ctx.query })
  }
}
```

When validation is declared on a route, KickJS automatically inserts the `validate()` middleware before any class-level or method-level middleware.

## Validating Params

Path parameters can also be validated:

```ts
const idParamsSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
})

@Get('/:id', { params: idParamsSchema })
async getById(ctx: RequestContext) {
  ctx.json({ id: ctx.params.id })
}
```

## Combining Body, Query, and Params

All three can be validated on the same route:

```ts
@Put('/:id', {
  params: z.object({ id: z.string().uuid() }),
  body: updateTodoSchema,
  query: z.object({ notify: z.coerce.boolean().optional() }),
})
async update(ctx: RequestContext) {
  // ctx.params.id, ctx.body, ctx.query.notify are all validated
}
```

## The validate() Middleware

Under the hood, route validation uses the `validate()` function from `@forinda/kickjs-http`. You can also use it directly as Express middleware:

```ts
import { validate } from '@forinda/kickjs-http'

// As standalone Express middleware
app.post('/custom',
  validate({ body: createTodoSchema }),
  (req, res) => res.json(req.body),
)
```

The `validate()` function accepts a `ValidationSchema`:

```ts
interface ValidationSchema {
  body?: any    // Zod schema (or any object with .safeParse())
  query?: any
  params?: any
}
```

It works with any validation library that implements the `.safeParse(data)` protocol returning `{ success: true, data }` or `{ success: false, error: { issues } }`. Zod is the recommended choice.

## Validated Data Replacement

On successful validation, the raw request data is replaced with the parsed output. This means Zod transforms, defaults, and coercions are applied:

```ts
const schema = z.object({
  count: z.coerce.number().default(10),
  active: z.coerce.boolean().optional(),
})

@Get('/', { query: schema })
async list(ctx: RequestContext) {
  // ctx.query.count is a number (coerced from string "10")
  // ctx.query.active is a boolean if provided
}
```

## Error Response Format

When validation fails, the response is a `422 Unprocessable Entity` with this structure:

```json
{
  "message": "Title is required",
  "errors": [
    { "field": "title", "message": "Title is required" },
    { "field": "priority", "message": "Invalid enum value" }
  ]
}
```

The top-level `message` is taken from the first validation issue. Each entry in `errors` includes:

- **field** -- the dotted path to the invalid field (e.g. `"address.zip"` for nested objects)
- **message** -- the Zod error message for that field

For query parameter errors, the message reads `"Invalid query parameters"`. For path parameter errors, it reads `"Invalid path parameters"`. For body errors, the first issue message is used.

## Defining Reusable DTOs

Define schemas in dedicated DTO files and use `z.infer` to extract the TypeScript type:

```ts
// application/dtos/create-todo.dto.ts
import { z } from 'zod'

export const createTodoSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

export type CreateTodoDTO = z.infer<typeof createTodoSchema>
```

Pass the schema to the route decorator and use the type in your use case:

```ts
@Post('/', { body: createTodoSchema })
async create(ctx: RequestContext) {
  const dto: CreateTodoDTO = ctx.body
  await this.createTodoUseCase.execute(dto)
}
```

## OpenAPI Integration

When the `@forinda/kickjs-swagger` adapter is active, Zod schemas passed to route decorators are used to generate OpenAPI request body and parameter documentation automatically. No additional annotations are needed for basic schema documentation -- the Zod structure is introspected at startup.
