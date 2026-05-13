---
'@forinda/kickjs': minor
---

feat(kickjs): `RequestContext.signal` — `AbortSignal` for request-scoped cancellation

`RequestContext` now exposes a `signal: AbortSignal` getter that fires when the underlying HTTP request closes (client disconnect, response sent, or timeout). Thread it through anything that takes an `AbortSignal` so the work cancels as soon as the client gives up.

```ts
import { Controller, Get, Autowired, type RequestContext } from '@forinda/kickjs'
import { TasksRepository } from './tasks.repository'

@Controller()
export class TasksController {
  @Autowired() private readonly tasks!: TasksRepository

  @Get('/:id/full')
  async showFull(ctx: RequestContext) {
    const row = await this.tasks.findFullById(ctx.params.id as string, ctx.signal)
    if (!row) return ctx.notFound()
    ctx.json(row)
  }
}
```

The repo passes `signal` to `db.query.<table>.findUnique({ signal })`; if the client disconnects mid-flight, kickjs-db's M5.A.2 plumbing maps the abort to `RelationalQueryCancelledError` and short-circuits the in-flight query instead of churning a connection until completion.

**Why this exists** — M5.A.2 (`@forinda/kickjs-db@5.6.0`) shipped the `signal?: AbortSignal` option on `FindManyOptions` / `FindFirstOptions` / `FindUniqueOptions` with a docstring that pointed adopters at "`RequestContext.signal` from kickjs-http". `RequestContext.signal` didn't actually exist yet; this release closes that gap so the integration story is honoured end-to-end.

**Implementation note** — the per-request `AbortController` is cached on the underlying `req` object via a Symbol key, so the multiple `RequestContext` wrappers that router-builder constructs (one per middleware, one per contributor pipeline, one for the main handler) all observe the same signal. The signal aborts on either `req.on('close')` or `res.on('close')` — whichever fires first; subsequent closes are no-ops.

Tests: 6 new unit cases in `packages/kickjs/__tests__/context-signal.test.ts` — initial-state, request-close abort, response-close abort, identity stability, shared-controller across multiple `RequestContext` wrappers for the same `req`, idempotency on repeated abort.

Demonstrated end-to-end in `examples/task-kickdb-api`: `TasksController.showFull` (`GET /tasks/:id/full`), `WorkspacesController.showFull` (`GET /workspaces/:id/full`), and `WorkspacesController.ownedBy` (`GET /workspaces/owned-by/:userId`) all thread `ctx.signal` into the corresponding `findFullById` / `listOwnedByUser` repo methods.

Closes the M5 exit-gate item that referenced `ctx.signal` literally. Additive — no breaking change. M5 "no major bumps" rule respected.
