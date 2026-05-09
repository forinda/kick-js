---
'@forinda/kickjs-db': minor
---

feat(db): `AbortSignal` threading on `db.query.*` + `RelationalQueryCancelledError` (M5.A.2)

`FindManyOptions` / `FindFirstOptions` / `FindUniqueOptions` accept a new optional `signal: AbortSignal`. Bind to `RequestContext.signal` from kickjs-http to short-circuit relational queries when the client disconnects or the request times out — no more wrapping every call site in a manual `Promise.race`.

```ts
@Service()
export class TasksRepository {
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}

  findFullById(id: string, signal: AbortSignal) {
    return this.db.query.tasks.findUnique({
      where: (_t, eb) => eb('id', '=', id),
      with: { comments: true, assignees: true, labels: true },
      signal,
    })
  }
}

@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksRepository) {}
  @Get('/tasks/:id')
  async show(ctx: RequestContext) {
    return ctx.json(await this.tasks.findFullById(ctx.params.id, ctx.signal))
  }
}
```

When the signal fires, the promise rejects with the new `RelationalQueryCancelledError` (extends `KickDbError`, code `relational_query_cancelled`). The signal's `reason` flows onto the error's `cause` field so adopters can inspect upstream causes (HTTP timeout vs explicit cancel vs user disconnect).

Already-aborted signals short-circuit before any compile or DB round trip. Driver-level AbortError shapes (DOM `AbortError`, PG SQLSTATE `57014`, mysql2 `EAGAIN_QUERY_INTERRUPTED`, better-sqlite3 `SQLITE_INTERRUPT`) are normalised to `RelationalQueryCancelledError`. Unrelated rejections pass through verbatim.

Default cancellation strategy is Kysely 0.29's `'ignore query'` — JS-side promise rejects, DB-side query keeps running until completion. The stricter `'cancel query'` (`pg_cancel_backend` / `KILL QUERY`) requires per-dialect support and isn't safe to default across all peer adapters yet; adopters who need it drive Kysely directly via `db.qb`. A future minor may surface a per-call override.

Spec: [`docs/db/spec-abortsignal-threading.md`](https://github.com/forinda/kick-js/blob/main/docs/db/spec-abortsignal-threading.md). Tests: 11 new unit cases in `packages/db/__tests__/unit/abort-signal-unit.test.ts` + 3 PG integration cases (`packages/db-pg/__tests__/integration/abort-signal-pg.test.ts`) + 3 SQLite cases (`packages/db-sqlite/__tests__/integration/abort-signal-sqlite.test.ts`).

Additive — no breaking change. M5 "no major bumps" rule respected.
