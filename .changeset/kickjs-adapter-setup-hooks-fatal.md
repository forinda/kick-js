---
'@forinda/kickjs': patch
---

An adapter's `beforeMount` or `beforeStart` that throws now stops the app from booting, instead of being logged while the server started anyway. The adapter hadn't finished wiring itself, so the app served half-built — `kickDbAdapter({ migrationsOnBoot: 'fail-if-pending' })` logged "pending migrations" and then served requests against the unmigrated database. `afterStart` runs once the server is listening, so its failure is still logged and the server keeps running.
