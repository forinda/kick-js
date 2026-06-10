---
title: Modules & Controllers
subtitle: Structuring a KickJS app
number: '02'
tag: HTTP
accent: '#2563eb'
---

# Modules, Controllers & Routes

A KickJS app is a set of **modules**. Each module groups controllers, services, and repositories for one slice of the domain.

## A controller

```ts
import { Controller, Get, Post, Autowired, type RequestContext } from '@forinda/kickjs'
import { TaskService } from './task.service'

@Controller('/tasks')
export class TaskController {
  @Autowired() private readonly tasks!: TaskService

  @Get('/')
  list(ctx: RequestContext) {
    ctx.json(this.tasks.all())
  }

  @Post('/')
  create(ctx: RequestContext) {
    const task = this.tasks.create(ctx.body)
    ctx.created(task) // 201 + body
  }

  @Get('/:id')
  show(ctx: RequestContext) {
    const task = this.tasks.find(ctx.params.id)
    task ? ctx.json(task) : ctx.notFound()
  }
}
```

Every handler receives a `RequestContext` — `ctx.body`, `ctx.params`, `ctx.query`, `ctx.headers`, plus response helpers (`ctx.json`, `ctx.created`, `ctx.noContent`, `ctx.notFound`).

## A module

```ts
import { defineModule } from '@forinda/kickjs'
import { TaskController } from './task.controller'
import { TaskService } from './task.service'

export const taskModule = defineModule({
  controllers: [TaskController],
  providers: [TaskService],
})
```

## Bootstrap

```ts
import { bootstrap, helmet, cors, requestId } from '@forinda/kickjs'
import express from 'express'
import { taskModule } from './modules/task/task.module'

export const app = await bootstrap({
  modules: [taskModule],
  middleware: [helmet(), cors(), requestId(), express.json()],
})
```

## Why it matters

- **Boundaries** — a module is the unit of ownership. Teams own modules, not files scattered across the tree.
- **Auto-discovery + HMR** — the Vite dev plugin discovers `*.module.ts` and hot-reloads on save, no full restart.
- **Composability** — modules can be bundled into plugins and shipped as packages.

## Next

[Validation & Schema →](./03-validation-and-schema.md)
