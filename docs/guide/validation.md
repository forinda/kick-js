# Validation

KickJS validates request data through the [`@forinda/kickjs-schema`](schema.md) abstraction, so any wrapped schema — Zod, Valibot, Yup, or anything implementing Standard Schema v1 — works without changing the route decorator. Validation can be declared inline on route decorators or applied manually with the `validate()` middleware. Failed validation returns a `422` response with structured error details.

::: tip One pipeline, three libraries
Under the hood the validate middleware calls `detectSchema(schema).safeParse(payload)`. The same `KickSchema` flows into the swagger spec generator and `loadEnvFromSchema()` — so picking Valibot for one DTO and Yup for another in the same project Just Works, no extra config. See the [schema-agnostic validation guide](schema.md) for the adapter surface.
:::

## Inline Validation on Route Decorators

The route decorators (`@Get`, `@Post`, `@Put`, `@Delete`, `@Patch`) accept a second argument with `body`, `query`, and `params` schemas. Pass a Zod, Valibot, or Yup schema directly — `detectSchema()` routes each one to the right adapter:

```ts
import { Controller, Post, Put, Get, type Ctx } from '@forinda/kickjs'
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
  async create(ctx: Ctx<KickRoutes.TodoController['create']>) {
    // ctx.body is validated AND typed as { title: string; priority: 'low' | 'medium' | 'high' }
    ctx.created(ctx.body)
  }

  @Put('/:id', { body: updateTodoSchema })
  async update(ctx: Ctx<KickRoutes.TodoController['update']>) {
    ctx.json(ctx.body)
  }

  @Get('/search', { query: searchQuerySchema })
  async search(ctx: Ctx<KickRoutes.TodoController['search']>) {
    ctx.json({ query: ctx.query })
  }
}
```

When validation is declared on a route, KickJS automatically inserts the `validate()` middleware before any class-level or method-level middleware. The `Ctx<KickRoutes.X['method']>` annotation also makes `ctx.body`, `ctx.params`, and `ctx.query` typed at compile time via the generated `KickRoutes` namespace — see [Type Generation](typegen.md).

## Validating Params

Path parameters can also be validated:

```ts
const idParamsSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
})

@Get('/:id', { params: idParamsSchema })
async getById(ctx: Ctx<KickRoutes.TodoController['getById']>) {
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
async update(ctx: Ctx<KickRoutes.TodoController['update']>) {
  // ctx.params.id, ctx.body, ctx.query.notify are all validated AND typed
}
```

## The validate() Middleware

Under the hood, route validation uses the `validate()` function from `@forinda/kickjs`. You can also use it directly as Express middleware:

```ts
import { validate } from '@forinda/kickjs'

// As standalone Express middleware
app.post('/custom', validate({ body: createTodoSchema }), (req, res) => res.json(req.body))
```

The `validate()` function accepts a `ValidationSchema`:

```ts
interface ValidationSchema {
  body?: any // Zod schema (or any object with .safeParse())
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

Define schemas in dedicated DTO files and extract the TypeScript type with the library's native infer helper. The three adapters round-trip identically through the validate middleware — pick whichever you prefer:

```ts
// application/dtos/create-todo.dto.ts — Zod (recommended default)
import { z } from 'zod'

export const createTodoSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

export type CreateTodoDTO = z.infer<typeof createTodoSchema>
```

```ts
// application/dtos/create-todo-valibot.dto.ts — Valibot
import * as v from 'valibot'

export const createTodoSchema = v.object({
  title: v.pipe(v.string(), v.minLength(1, 'Title is required'), v.maxLength(200)),
  priority: v.optional(v.picklist(['low', 'medium', 'high']), 'medium'),
})

export type CreateTodoDTO = v.InferOutput<typeof createTodoSchema>
```

```ts
// application/dtos/create-todo-yup.dto.ts — Yup
import * as yup from 'yup'

export const createTodoSchema = yup
  .object({
    title: yup.string().required('Title is required').max(200),
    priority: yup.string().oneOf(['low', 'medium', 'high']).default('medium'),
  })
  .required()

export type CreateTodoDTO = yup.InferType<typeof createTodoSchema>
```

Pass any of those schemas to the route decorator and use the matching type in your use case — `detectSchema()` figures out the right adapter at startup, no `fromZod` / `fromValibot` / `fromYup` wrap is required on the route side:

```ts
@Post('/', { body: createTodoSchema })
async create(ctx: RequestContext) {
  const dto: CreateTodoDTO = ctx.body
  await this.createTodoUseCase.execute(dto)
}
```

::: tip Adapter caveats

- **Zod** — broadest ecosystem, default for `kick new`.
- **Valibot** — smaller bundle; transforms validate the default _through_ the pipe, so `v.optional(v.pipe(v.string(), v.transform(Number)), '3000')` lands at `3000: number` (not the raw `'3000'` string).
- **Yup** — classic API; `.url()` only matches http/https (use `.string().required()` for `postgres://`-style connection strings), and `__outputType` types required strings as `string | undefined` because `.required()` is enforced at runtime, not in the type. The validate middleware still rejects undefined at runtime.

See [Schema-agnostic validation](schema.md) for the adapter detection order and how to register a custom one.
:::

## OpenAPI Integration

When the `@forinda/kickjs-swagger` adapter is active, schemas passed to route decorators are used to generate OpenAPI request body and parameter documentation automatically — Zod, Valibot, and Yup all flow through the same `detectSchema().toJsonSchema()` pipeline, so no additional annotations are needed. Each adapter implements `toJsonSchema()`; Zod uses the built-in `toJSONSchema()`, Valibot delegates to `@valibot/to-json-schema`, and Yup walks `describe()` output. See [`@forinda/kickjs-swagger`](../api/swagger.md) for the spec-generation surface.
