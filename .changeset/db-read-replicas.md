---
'@forinda/kickjs-db': minor
---

Read replicas: `createDbClient({ schema, dialect, replica })` — a dialect, or several used in turn. Reads outside a transaction (`selectFrom`, `db.query`) go to a replica; writes, raw `db.qb`, and everything inside a transaction go to the primary. `db.primary` is the same client with reads pinned to the primary, for reading your own writes while replicas lag; `findOrCreate()` and `upsert()`'s MySQL read-back already use it. `db.destroy()` closes the replicas too.
