---
'@forinda/kickjs-db': patch
---

Work that outlives its transaction no longer looks like it's inside it. An async continuation started inside `transaction()` but still running after the commit (an un-awaited promise, say) used to see `inTransaction: true` and fail with Kysely's bare "Transaction is already committed". `inTransaction` is now `false` once the transaction (or savepoint) finishes, a query from that continuation throws `TransactionFinishedError` naming the likely cause, and `transaction()` / `afterCommit()` behave as outside a transaction.
