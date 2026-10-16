---
'@forinda/kickjs-db': patch
---

- The `beforeQuery` event fires. It was declared and documented but never emitted, so its listeners never ran. It now runs synchronously as each statement is sent, and a listener may rewrite `sql` or `parameters`.
- `db.query` with a `signal` cancels the query on the server (Postgres `pg_cancel_backend`, MySQL `KILL QUERY`), as documented. It only stopped waiting before, leaving the query running and holding its pool connection. better-sqlite3 runs synchronously, so there is nothing in flight to stop there.
