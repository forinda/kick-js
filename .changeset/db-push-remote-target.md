---
'@forinda/kickjs-db': patch
---

`kick db push` asks before changing a remote database. When the connection string points at a host that isn't this machine or a neighbouring container (`localhost`, `127.*`, `::1`, `*.local`, `*.localhost`, a dotless compose service name), it asks in a terminal and refuses otherwise unless `--yes` is passed. Push is for a local prototyping database, and `NODE_ENV` is often unset in a shell, so it can't be the only guard. A target push can't see (a `db.adapter()` factory with no connection string) behaves as before; the migration-history, drift and data-loss checks still apply.
