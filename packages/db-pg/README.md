# @forinda/kickjs-db-pg

> node-postgres adapter for [`@forinda/kickjs-db`](../db).

Wraps `pg.Pool` with the `MigrationAdapter` contract so the runner can apply
migrations and introspect against a real Postgres database. Also provides
the Kysely `PostgresDialect` factory for the query layer (T19b).

**Status:** Pre-release. Private until M1 ships and the API stabilises.
