---
description: Where to begin with kick/db — a new project on SQLite, Postgres or MySQL, an existing database, or coming from Prisma, Drizzle, TypeORM or Sequelize.
---

# Start Here

kick/db is KickJS's database layer: you write the schema in TypeScript, and it derives the migrations and the query types from it. Where you begin depends on what you already have.

## A new project

Pick the database you'll run in production, and follow its page from install to the first query:

- [SQLite](./index.md) — nothing to provision, so it's the quickest way to try kick/db. Good for small apps, embedded use and tests.
- [PostgreSQL](./get-started-postgres.md) — the most complete dialect. Choose it unless you have a reason not to.
- [MySQL / MariaDB](./get-started-mysql.md) — when your infrastructure already runs MySQL.

The schema, migrations and queries read the same on all three; the pages differ in connection setup and a few day-one details. [Drivers](./drivers.md#choosing-a-dialect) compares them.

## An existing database

[Adopting kick/db on an existing database](./adopting.md) introspects the live schema into a `schema.ts`, baselines the migration history so nothing re-runs, and checks that the two really match — so you can move over while your current code keeps running.

## Coming from another ORM

Each guide maps that ORM's concepts onto kick/db, shows common tasks side by side, and says plainly what kick/db doesn't have yet:

- [Coming from Prisma](./coming-from-prisma.md)
- [Coming from Drizzle](./coming-from-drizzle.md)
- [Coming from TypeORM](./coming-from-typeorm.md)
- [Coming from Sequelize](./coming-from-sequelize.md)

## Learning by building

[Taskboard](../taskboard/1-first-module.md) builds one app in five parts — modules, a database, authentication, permissions, file uploads, a production deploy — so you see the patterns in place rather than one at a time.

## Then

- [How kick/db works](./concepts.md) — how schema, snapshots, migrations and the typed client fit together. Reading it once makes most error messages make sense.
- [Tables & Columns](./schema.md), [Queries](./queries.md), [Transactions](./transactions.md), [Migrations](./migrations.md) — the references you'll come back to.
