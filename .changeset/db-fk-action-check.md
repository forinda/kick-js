---
'@forinda/kickjs-db': patch
---

`references(…, { onDelete, onUpdate })` refuses an action that isn't one of `'cascade'`, `'restrict'`, `'set_null'`, `'set_default'` or `'no_action'`, with an error naming the bad value. `kick db generate` loads the schema without a type check, so a mistype such as `'set null'`, `'SET NULL'` or `'setNull'` used to reach the migration as `ON DELETE undefined`. `FK_ACTION_NAMES` lists the valid actions.
