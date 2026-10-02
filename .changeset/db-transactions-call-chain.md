---
'@forinda/kickjs-db': minor
---

Transactions that follow the call chain, `afterCommit`, and retry.

- **Call-chain transactions:** inside `transaction(fn)`, the plain client joins the transaction — repositories using the injected `db` take part without being handed `tx`. Concurrent requests each keep their own. `db.inTransaction` reports whether one is open.
- **Nesting:** `transaction({ nested })` — `'reuse'` (default) runs inside the open transaction, `'savepoint'` behind a savepoint, `'separate'` in an independent transaction on another connection (not on SQLite). Before, a nested `db.transaction()` always opened a separate one.
- **`afterCommit(fn)`:** runs once the transaction commits, dropped on rollback (including a rolled-back savepoint); runs at once outside a transaction. A failing hook is reported, not thrown.
- **`retry`:** `transaction({ retry: true })` runs the whole transaction again on a serialization failure or deadlock (`err.retryable`), with jittered exponential backoff; a `transactionRetry` event fires per retry.
- `savepoint()` on the plain client now opens the savepoint on the call chain's transaction, and throws a clear error outside one.
