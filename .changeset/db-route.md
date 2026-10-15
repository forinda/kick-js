---
'@forinda/kickjs-db': minor
---

`createDbClient({ route })` decides where each read outside a transaction goes when there are replicas. It returns `'primary'`, a replica index, or `undefined` for the default round-robin, and is called with the table being read. Use it for read-your-writes, pinning tables that replicate late, choosing a replica by region, or skipping a lagging one. Transactions and `db.primary` still always use the primary.
