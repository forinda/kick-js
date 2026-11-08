---
'@forinda/kickjs': patch
---

An optional or undeclared settings section now follows a `.env` edit too. It isn't bound, so `get()` loaded it once and kept that value, through `kick dev` rebuilds, until a restart. Each start and rebuild, and `reloadEnv()`, now has it read again. The configuration guide has a new "After a `.env` edit" section on reading sections so reloads apply.
