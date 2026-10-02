---
'@forinda/kickjs-db': minor
---

Two commands for running migrations in CI and production:

- `kick db check` fails (exit 1) when the schema has changes no migration covers, a migration isn't reviewed, or a reviewed migration was edited after review — everything `migrate latest` would refuse, found without a database, so CI catches it before a deploy does. Also exported as `checkMigrations({ config, cwd })`.
- `kick db migrate unlock` releases the migration lock a run left behind when it was killed mid-migration. Until now that needed a hand-written `UPDATE` on the lock table; the "another process holds the migration lock" error now says to use it.
