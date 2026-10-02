---
'@forinda/kickjs-db': minor
---

Typed database errors.

A failed query now throws `UniqueViolationError`, `ForeignKeyViolationError`, `CheckViolationError`, `NotNullViolationError`, `SerializationFailureError`, `DeadlockError`, `ConnectionError` or the `DatabaseError` base instead of the driver's own error — on Postgres, MySQL and SQLite, for queries, transactions (including a serializable `COMMIT`), savepoints and connecting. Each carries the `constraint`, `table`, `columns` and `detail` the database reported, `driverCode`, and the driver's error as `cause`. Serialization failures and deadlocks are `retryable`. A `UniqueViolationError` has `status: 409`, so an unhandled one answers `409` rather than `500`.

Code that caught driver errors by their own class or `code` should read `err.cause` (or switch to the typed classes).
