---
'@forinda/kickjs-db': minor
---

Query timeouts that cancel on the server. `db.timeout(ms, { signal? })` returns the execute options for any query builder — `.execute(db.timeout(5_000))` — that cancel the query once it has run `ms` (Postgres `pg_cancel_backend`, MySQL `KILL QUERY`), or when `signal` aborts first, and reject with the reason of whichever fired first — a `TimeoutError` when it's the timeout. `db.query` reads take `timeoutMs` alongside `signal`, rejecting with `RelationalQueryCancelledError` whose `cause` is the `TimeoutError`.

Inside a transaction a timed-out or aborted query is abandoned rather than cancelled: cancelling would abort the transaction, and Postgres would turn its `COMMIT` into a `ROLLBACK`. A timeout's rejection is a `DOMException` named `TimeoutError`; an aborted `signal` rejects with its own reason. `signal` and `timeoutMs` apply to the top level of a `db.query` read; nested `with` levels no longer accept them.
