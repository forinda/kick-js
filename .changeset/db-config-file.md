---
'@forinda/kickjs-db': minor
---

`kick db … --config <file>` (`-c`, or `KICK_DB_CONFIG`) runs a command with a db config from a named file — `db/staging.ts`, `db/prod.ts`, or one per database — replacing kick.config's `db` block for that run. The standalone `kickjs-db` bin takes the same flag. The file exports a db config (or a kick.config-style object with a `db` block); each run with one prints `db config: <file>` first.
