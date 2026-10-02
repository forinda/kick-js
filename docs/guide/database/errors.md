# Errors

kick/db reports problems as classes you can `instanceof`, each carrying what you need to act on it. Query failures come from the database; the rest come from kick/db itself — a relational query that can't be built, a migration the runner refuses.

Every error extends `KickDbError` and has a stable `code`.

## Query errors

A failed query throws one of these instead of the driver's own error — on Postgres, MySQL and SQLite, for queries, transactions (including a serializable `COMMIT`), savepoints and connecting:

| Error                       | When                                                           | Extras            |
| --------------------------- | -------------------------------------------------------------- | ----------------- |
| `UniqueViolationError`      | a row duplicates a unique or primary key                       | `status: 409`     |
| `ForeignKeyViolationError`  | a row references a missing row, or a referenced row is deleted |                   |
| `CheckViolationError`       | a CHECK constraint rejects the row                             |                   |
| `NotNullViolationError`     | a NOT NULL column gets null                                    |                   |
| `SerializationFailureError` | a transaction conflicted with a concurrent one                 | `retryable: true` |
| `DeadlockError`             | the database cancelled one side of a deadlock                  | `retryable: true` |
| `ConnectionError`           | the database can't be reached, or dropped the connection       |                   |
| `DatabaseError`             | anything else the database reports — the base class            |                   |

Each carries what the database said:

| Field        | Meaning                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------- |
| `dialect`    | `'postgres'`, `'mysql'` or `'sqlite'`                                                        |
| `driverCode` | SQLSTATE (Postgres, MySQL) or the driver's code (`SQLITE_CONSTRAINT_UNIQUE`, `ER_DUP_ENTRY`) |
| `constraint` | the constraint's name                                                                        |
| `table`      | the table                                                                                    |
| `columns`    | the columns involved, in key order                                                           |
| `detail`     | the database's own explanation (Postgres)                                                    |
| `cause`      | the driver's original error                                                                  |

Not every database says everything:

| Error       | Postgres                           | MySQL                      | SQLite         |
| ----------- | ---------------------------------- | -------------------------- | -------------- |
| Unique      | constraint, table, columns, detail | constraint, table          | table, columns |
| Foreign key | constraint, table, columns, detail | constraint, table, columns | —              |
| Check       | constraint, table                  | constraint                 | constraint     |
| Not null    | table, columns                     | columns                    | table, columns |

Errors that don't come from the database — a `TypeError` in your own code — pass through untouched.

### Handling them

Catch the kind you can do something about and rethrow the rest:

```ts
import { HttpException } from '@forinda/kickjs'
import { ForeignKeyViolationError, UniqueViolationError } from '@forinda/kickjs-db'

try {
  await this.db.insertInto('members').values({ teamId, email }).execute()
} catch (err) {
  if (err instanceof UniqueViolationError && err.columns.includes('email')) {
    throw HttpException.conflict('That email is already on the team')
  }
  if (err instanceof ForeignKeyViolationError) {
    throw HttpException.notFound('No such team')
  }
  throw err
}
```

Left unhandled, a `UniqueViolationError` answers `409` rather than `500` — it carries `status: 409`. Its message names the table and columns, never the duplicate value. Other database errors answer `500` and are logged.

**Retryable errors** — serialization failures and deadlocks — mean "run the transaction again". Let the transaction do it with [`retry`](./transactions#retrying) rather than catching them yourself.

**Calling a driver directly?** `translateDbError(err, dialect)` turns its error into one of these classes:

```ts
import { translateDbError } from '@forinda/kickjs-db'

try {
  await pool.query('…')
} catch (err) {
  throw translateDbError(err, 'postgres')
}
```

## Error reference

### Query

| Error / `code`                                        | Cause                                                                                                                         | Fix                                                                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `UniqueViolationError` · `unique_violation`           | duplicate value for a unique / primary key                                                                                    | check first, or catch it and answer `409`; for "insert or update" use an upsert ([recipes](./raw-sql#upsert)) |
| `ForeignKeyViolationError` · `foreign_key_violation`  | parent row missing, or still referenced on delete                                                                             | validate the id first; on delete, use `onDelete: 'cascade'` / `'set_null'` or delete children first           |
| `CheckViolationError` · `check_violation`             | a `check()` constraint failed                                                                                                 | validate input against the same rule (`err.constraint` names it)                                              |
| `NotNullViolationError` · `not_null_violation`        | null for a NOT NULL column                                                                                                    | give the column a value or a `.default()`                                                                     |
| `SerializationFailureError` · `serialization_failure` | concurrent transactions conflicted (Postgres `40001`, MySQL lock wait timeout, SQLite busy)                                   | `transaction({ retry: true })`                                                                                |
| `DeadlockError` · `deadlock`                          | two transactions waited on each other                                                                                         | `transaction({ retry: true })`; touch rows in a consistent order                                              |
| `ConnectionError` · `connection_error`                | database unreachable or connection dropped                                                                                    | check the connection settings and that the database is up; pool limits                                        |
| `DatabaseError` · `database_error`                    | anything else (`driverCode` says what)                                                                                        | read `err.message` / `err.cause`                                                                              |
| `TransactionFinishedError` · `transaction_finished`   | a query ran after its transaction had committed or rolled back — usually a promise inside `transaction()` that wasn't awaited | `await` every query inside `transaction()`; move work meant for after the commit into `afterCommit()`         |

### Relational queries (`db.query.*`)

| Error / `code`                                                                             | Cause                                                                                                                       | Fix                                                                                 |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `RelationalQueryUnknownRelationError` · `KICK_DB_RELATIONAL_UNKNOWN_RELATION`              | a `with` key that isn't declared                                                                                            | declare it in `relations()` ([Relational Queries](../db-relational-query))          |
| `RelationalQueryDepthError` · `KICK_DB_RELATIONAL_DEPTH_EXCEEDED`                          | `with` nested deeper than `maxDepth` (default 5)                                                                            | nest less, or pass `{ maxDepth: N }` if it's intended                               |
| `RelationalQueryAliasCollisionError` · `KICK_DB_RELATIONAL_ALIAS_COLLISION`                | a relation has the same name as a column                                                                                    | rename the relation or the column                                                   |
| `RelationalQueryMissingInverseError` · `KICK_DB_RELATIONAL_MISSING_INVERSE`                | a `many` with no `one` pointing back, and zero or several foreign keys to pair                                              | declare the inverse `one`, or tag both sides with the same `relationName`           |
| `RelationalQueryAmbiguousRelationNameError` · `KICK_DB_RELATIONAL_AMBIGUOUS_RELATION_NAME` | several `one` relations share a `relationName`                                                                              | make each `relationName` unique per pair of tables                                  |
| `RelationalQueryCancelledError` · `relational_query_cancelled`                             | the `signal` passed to the query aborted                                                                                    | expected when a request is cancelled; `err.cause` holds the abort reason            |
| `KICK_DB_RELATIONAL_NOT_SUPPORTED` (a `KickDbError`)                                       | the MySQL migration adapter found MySQL older than 8.0 or MariaDB older than 10.5 — relational queries need `JSON_ARRAYAGG` | upgrade the server, or use the query builder instead of `db.query`                  |
| `KICK_DB_POOL_NOT_CLOSABLE` (a `KickDbError`)                                              | `pgAdapter` / `mysqlAdapter` got `endPoolOnClose: true` with a pool that has no `end()`                                     | pass a pool with `end()`, or leave `endPoolOnClose` off and close the pool yourself |

### Migrations

| Error / `code`                                               | Cause                                                                                            | Fix                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `UnreviewedMigrationError` · `migration_unreviewed`          | a migration with `reviewed: false` applied outside development                                   | read its SQL, then `kick db migrate review <id>`; in tests, `requireReviewed: false`       |
| `MigrationHashError` · `migration_hash_mismatch`             | a migration's files changed after the journal recorded them (`expected` / `actual`)              | undo the edit — applied migrations are immutable; put the change in a new migration        |
| `MigrationDriftError` · `migration_drift`                    | the live database differs from the last applied snapshot (`err.diff`: added / removed / changed) | find who changed the database by hand; fold the change into a migration, or revert it      |
| `MigrationLockError` · `migration_lock_held`                 | another migration run holds the lock                                                             | wait for it; if a crashed run left it, clear it (below)                                    |
| `MigrationEnumDropError` · `migration_enum_drop_unconfirmed` | the migration removes Postgres enum values                                                       | review the `USING` casts in `up.sql`, then `--confirm-enum-drop` / `confirmEnumDrop: true` |
| `RemovedValueAsDefaultError` · `removed_value_as_default`    | `kick db generate`: an enum value being removed is a column's default                            | change or drop that default first                                                          |
| `CompositeEnumReferenceError` · `composite_enum_reference`   | an enum value removal blocked by a composite type using the enum                                 | change the composite type by hand, then generate again                                     |
| `SqliteRebuildRequiredError`                                 | `emitSqlite` needed a table rebuild but wasn't given both snapshots                              | pass `{ from, to }` — `kick db generate` always does                                       |

A run that crashed mid-migration can leave the lock held. Check `locked_by` (process id and start time) to be sure nothing is running, then:

```sql
UPDATE kick_migrations_lock SET locked_at = NULL, locked_by = NULL WHERE id = 1;
```

## Related

- [Queries → Transactions](./transactions) — `retry` for retryable errors
- [Migrations](./migrations)
- [Testing with kick/db](./testing#asserting-database-errors)
