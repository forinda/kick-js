---
'@forinda/kickjs-db': patch
---

`defaultNow()` on SQLite stores milliseconds — `strftime('%Y-%m-%d %H:%M:%f', 'now')` instead of `CURRENT_TIMESTAMP`, which has whole seconds — so rows inserted within the same second no longer tie on `ORDER BY createdAt`. The stored shape matches what kick/db writes for a `Date`. Applies to tables created or rebuilt from now on; drift checks ignore SQLite defaults.
