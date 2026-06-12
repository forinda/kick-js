---
'@forinda/kickjs-db': patch
---

`kick/db` typegen now honours `db.schemaPath` from kick.config, matching `kick db generate`. Previously a custom schema path produced working migrations but a silently untyped client (the typegen only probed the default `src/db/schema*` candidates). A configured-but-missing path falls back to the default candidates instead of emitting a broken import.
