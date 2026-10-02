---
'@forinda/kickjs-db': patch
---

Migration errors say what went wrong. A migration whose SQL fails throws `MigrationFailedError` — "Migration <id> failed: <the database's message>", with `id` and the driver error as `cause` — instead of the bare driver error, which didn't say which of several pending migrations broke. "Schema drift detected" now lists what drifted — `(added: users.bio)` — not only the counts.
