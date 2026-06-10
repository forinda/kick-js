---
title: Validation & Schema
subtitle: Zod, Valibot, or Yup — one interface
number: '03'
tag: Core
accent: '#8b5cf6'
---

# Validation & Schema

KickJS doesn't marry you to one validator. `@forinda/kickjs-schema` wraps **Zod, Valibot, Yup**, or any Standard-Schema library behind a single `KickSchema` interface. Route validation, env loading, and Swagger generation all read the same definition.

## Validate a request body

```ts
import { Controller, Post, validate, type RequestContext } from '@forinda/kickjs'
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

const CreateTask = fromZod(
  z.object({
    title: z.string().min(1),
    done: z.boolean().default(false),
  }),
)

@Controller('/tasks')
export class TaskController {
  @Post('/', { body: CreateTask })
  create(ctx: RequestContext) {
    // ctx.body is parsed + typed; invalid input already 422'd.
    ctx.created(ctx.body)
  }
}
```

## Bring your own validator

Same code, different wrapper — install only what you use:

```ts
import { fromValibot } from '@forinda/kickjs-schema/valibot'
import * as v from 'valibot'

const CreateTask = fromValibot(v.object({ title: v.string() }))
```

```ts
import { fromYup } from '@forinda/kickjs-schema/yup'
import * as yup from 'yup'

const CreateTask = fromYup(yup.object({ title: yup.string().required() }))
```

The Zod / Valibot / Yup peers are **optional** — `@forinda/kickjs-schema` ships no hard validator dependency.

## Why it matters

- **No lock-in** — adopt KickJS on a Valibot or Yup codebase without rewriting every schema.
- **One definition, many consumers** — the same schema validates requests, types `ctx.body`, and feeds the OpenAPI spec.
- **Typed end to end** — `ctx.body` infers from the schema; a typo is a compile error.

## Next

[Configuration & Env →](./04-configuration-and-env.md)
