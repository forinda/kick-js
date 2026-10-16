---
'@forinda/kickjs-db': minor
---

Query timeouts that cancel on the server. `db.timeout(ms, { signal? })` returns the execute options for any query builder — `.execute(db.timeout(5_000))` — that cancel the query once it has run `ms` (Postgres `pg_cancel_backend`, MySQL `KILL QUERY`), or when `signal` aborts first, and reject with a `TimeoutError`. `db.query` reads take `timeoutMs` alongside `signal`, rejecting with `RelationalQueryCancelledError` whose `cause` is the `TimeoutError`.
