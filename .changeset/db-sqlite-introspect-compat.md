---
'@forinda/kickjs-db': patch
---

`SqliteIntrospectDb.prepare(...).all` is no longer method-generic. better-sqlite3 v12's own `Statement.all(...params): Result[]` is non-generic, so the previous generic signature made a real `Database` instance structurally incompatible with `introspectSqlite(db)` — adopters had to cast. Row typing now happens inside the introspector; passing a better-sqlite3 `Database` directly type-checks.
