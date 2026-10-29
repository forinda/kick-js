---
'@forinda/kickjs-db': patch
---

A migration lock left by a process on the same machine that has exited is released by the next run instead of blocking it for `lockStaleAfter` (600s). Stopping `kick dev` while it applied migrations on boot no longer stops the next start with "Another process holds the migration lock". The default lock owner now records the host and, on Linux, the pid namespace as well as the process id, and `MigrationAdapter` gains an optional `lockHolder()` that every built-in adapter implements. Locks with a custom `owner`, held by another host or container, or under `lockStaleAfter: 0` behave as before.
