---
description: A TypeORM user's map to kick/db — entities, repositories, find options, relations, migrations, transactions and subscribers, with side-by-side code and what kick/db doesn't have yet.
---

# Coming from TypeORM

TypeORM describes the database through decorated entity classes and hands you a `Repository` or `EntityManager` that loads, tracks and saves instances of them. kick/db starts from the same place — tables declared in TypeScript — but stops short of the object layer: queries return plain rows typed from the schema, and every write is an explicit statement. There is no unit of work, no `save()` that decides between insert and update, and no lazy relations; in exchange you see every SQL statement in the code that runs it.

The closest thing to an entity class is the [base-class table form](../db-table-forms.md). `class User extends TableBase('users', { … })` declares the table, and the class is the row type. `User.table` is the table itself — what you pass to `relations()`, foreign keys and `insertSchema`. Queries return plain objects; `User.from(row)` turns one into a `User` when you want its methods.

## Concepts at a glance

| TypeORM                                                        | kick/db                                                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `@Entity()` class with `@Column()` fields                      | `TableBase('users', { … })` class, or `table()` — [Table Forms](../db-table-forms.md)                                                          |
| `@Column('varchar', { length: 255 })`, `@Column('decimal', …)` | `varchar(255)`, `decimal(12, 2)`, `timestamp()`, `json<T>()` — [Tables & Columns](./schema.md)                                                 |
| `@PrimaryGeneratedColumn()` / `('uuid')`                       | `serial().primaryKey()` / `uuid().primaryKey().defaultRandom()`                                                                                |
| `@CreateDateColumn()`                                          | `timestamp().notNull().defaultNow()`                                                                                                           |
| `@UpdateDateColumn()`                                          | `defaultNow()` on insert; set it yourself on update (auto-update is [D.10](../roadmap.md))                                                     |
| `@OneToMany` / `@ManyToOne`                                    | a foreign key with `.references()`, plus `relations()` with `many` / `one` — [Keys & Constraints](./constraints.md)                            |
| `@ManyToMany` + `@JoinTable`                                   | an explicit junction table; `through` in relational reads is [D.13](../roadmap.md)                                                             |
| `relations: { posts: true }`, `eager: true`                    | `db.query.users.findMany({ with: { posts: true } })` — one query — [Relational Queries](../db-relational-query.md)                             |
| lazy relations (`Promise<Post[]>`)                             | none — query the related rows when you need them                                                                                               |
| `DataSource.getRepository(User)`                               | the typed client (`db.selectFrom('users')`), behind your own repository — [Repositories](./repositories.md)                                    |
| `find` / `findOneBy` / `findAndCount`                          | `selectFrom(…).where(…).execute()` / `.executeTakeFirst()`, plus a count query                                                                 |
| `save()` / `insert()` / `update()` / `delete()`                | `insertInto` / `updateTable` / `deleteFrom` — [Queries](./queries.md)                                                                          |
| `upsert(values, ['email'])`                                    | `db.upsert(table, { values, target: ['email'] })` — [Upsert and find-or-create](./queries.md#upsert-and-find-or-create)                        |
| `MoreThanOrEqual`, `In`, `Like`, `IsNull`, `Not`               | `where('col', '>=', v)`, `'in'`, `'like'`, `'is', null`, `'!='`                                                                                |
| `createQueryBuilder()`                                         | the client _is_ a query builder ([Kysely](https://kysely.dev)), typed from the schema                                                          |
| `dataSource.transaction(async (manager) => …)`                 | `db.transaction(async () => …)` — code holding the plain client joins it — [Transactions](./transactions.md)                                   |
| `QueryRunner` (manual begin/commit)                            | none — `transaction(fn)` commits on return, rolls back on throw; `savepoint(fn)` nests                                                         |
| `@BeforeInsert`, subscribers                                   | no per-row hooks: put the logic in the service, a [custom column codec](../db-extensions.md), or query [events / plugins](./events-plugins.md) |
| `afterTransactionCommit` subscriber                            | `db.afterCommit(fn)` inside the transaction                                                                                                    |
| `@DeleteDateColumn()`, `softDelete()`                          | a nullable `deletedAt` you filter yourself; built-in soft delete is [D.10](../roadmap.md)                                                      |
| `@VersionColumn()`                                             | none yet — optimistic locking is [D.10](../roadmap.md)                                                                                         |
| class-validator on entities                                    | `insertSchema(User.table)` derives request validation from the table — [Validation from Tables](../db-table-schemas.md)                        |
| `QueryFailedError` + `driverError.code`                        | typed `UniqueViolationError`, `ForeignKeyViolationError`, … the same on every dialect — [Errors](./errors.md)                                  |
| `dataSource.query(sql, params)`                                | ``sql`…${param}`.execute(db.qb)`` — [Raw SQL](./raw-sql.md)                                                                                    |
| `migration:generate` / `migration:run` / `migration:revert`    | `kick db generate <name>` / `kick db migrate latest` / `kick db migrate rollback` — [Migrations](./migrations.md)                              |
| `synchronize: true`                                            | none on purpose — every change is a reviewed migration                                                                                         |
| seeds (third-party)                                            | a hand-written migration: `kick db generate seed_x --empty`; a seed command is [D.2](../roadmap.md)                                            |

## Side by side

### Define an entity

```ts
// TypeORM
@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id!: number
  @Column({ length: 255, unique: true }) email!: string
  @Column('text') name!: string
  @CreateDateColumn() createdAt!: Date
  @OneToMany(() => Post, (post) => post.author) posts!: Post[]

  get domain() {
    return this.email.split('@')[1]
  }
}

@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn() id!: number
  @ManyToOne(() => User, (user) => user.posts, { onDelete: 'CASCADE' }) author!: User
  @Column({ length: 200 }) title!: string
  @Column({ type: 'timestamp', nullable: true }) publishedAt!: Date | null
}
```

```ts
// kick/db — src/db/schema.ts
import { TableBase, integer, relations, serial, text, timestamp, varchar } from '@forinda/kickjs-db'

export class User extends TableBase(
  'users',
  {
    id: serial().primaryKey(),
    email: varchar(255).notNull().unique(),
    name: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  { rules: { email: { format: 'email' } } },
) {
  get domain() {
    return this.email.split('@')[1]
  }
}

export class Post extends TableBase('posts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => User.table.id, { onDelete: 'cascade' }),
  title: varchar(200).notNull(),
  publishedAt: timestamp(),
}) {}

export const userRelations = relations(User.table, ({ many }) => ({
  posts: many(Post.table),
}))

export const postRelations = relations(Post.table, ({ one }) => ({
  author: one(User.table, { fields: [Post.table.authorId], references: [User.table.id] }),
}))
```

Two differences to absorb:

- **The foreign key is a column you can see.** TypeORM hides `authorId` behind `author`; in kick/db `authorId` is a real column and `author` is a relation declared next to it. You write `authorId` when you insert.
- **Nullability is opt-out, not opt-in.** Columns are nullable unless you call `.notNull()`, and the row type follows: `publishedAt` is `Date | null`.

### Find and write

```ts
// TypeORM
const repo = dataSource.getRepository(User)
const user = await repo.findOneBy({ email: 'ada@example.com' })
const ada = await repo.save(repo.create({ email: 'ada@example.com', name: 'Ada' }))
await repo.update(ada.id, { name: 'Ada L.' })
await repo.delete(ada.id)
```

```ts
// kick/db
const row = await db
  .selectFrom('users')
  .selectAll()
  .where('email', '=', 'ada@example.com')
  .executeTakeFirst()
const user = row ? User.from(row) : null // only when you want `user.domain`

const ada = await db
  .insertInto('users')
  .values({ email: 'ada@example.com', name: 'Ada' })
  .returningAll()
  .executeTakeFirstOrThrow()
await db.updateTable('users').set({ name: 'Ada L.' }).where('id', '=', ada.id).execute()
await db.deleteFrom('users').where('id', '=', ada.id).execute()
```

`values()` only accepts columns the table has, with their types; `id` and `createdAt` are optional because the database fills them. Put these queries in a [repository](./repositories.md) if you want the `Repository` shape back — a factory that takes the client and returns the methods your services call.

### Load relations

```ts
// TypeORM
const user = await repo.findOne({
  where: { id: 1 },
  relations: { posts: true },
  order: { posts: { publishedAt: 'ASC' } },
})
```

```ts
// kick/db
const user = await db.query.users.findFirst({
  where: (u, eb) => eb('id', '=', 1),
  with: {
    posts: { orderBy: (_p, eb) => eb.ref('publishedAt') },
  },
})
// user.posts: Post[]

const posts = await db.query.posts.findMany({ with: { author: true } })
// posts[0].author: User | null
```

Each relation also takes its own `where` and `limit` — `posts: { where: …, limit: 5 }` — which TypeORM's `relations` can't express without a query builder. `with` compiles to a single query whatever the depth — no N+1, and no lazy property that queries behind your back. `orderBy` takes an expression and sorts ascending; wrap the column in `desc()` (from `@forinda/kickjs-db`) for descending: `orderBy: (_p, eb) => desc(eb.ref('publishedAt'))`. `db.query` is read-only; writes go through `insertInto` / `updateTable` / `deleteFrom`.

### Find operators

```ts
// TypeORM
await repo.find({
  where: [
    { createdAt: MoreThanOrEqual(since), id: In([1, 2, 3]), name: Like('Ada%') },
    { email: Like('%@example.org') },
  ],
  order: { createdAt: 'DESC' },
  take: 20,
  skip: 0,
})
```

```ts
// kick/db
await db
  .selectFrom('users')
  .selectAll()
  // Each object in TypeORM's where array is one OR branch; its fields are ANDed.
  .where((eb) =>
    eb.or([
      eb.and([eb('createdAt', '>=', since), eb('id', 'in', [1, 2, 3]), eb('name', 'like', 'Ada%')]),
      eb('email', 'like', '%@example.org'),
    ]),
  )
  .orderBy('createdAt', 'desc')
  .limit(20)
  .offset(0)
  .execute()

await db.selectFrom('posts').select('title').where('publishedAt', 'is', null).execute()
```

Chained `where` calls are `AND`; `eb.or([...])` and `eb.and([...])` group. Column names and value types are checked against the schema — a typo or a string for `id` doesn't compile. A user-supplied `LIKE` pattern needs escaping; see [Searching with `LIKE`](./raw-sql.md#searching-with-like).

### Transactions

```ts
// TypeORM — every call inside must go through `manager`
await dataSource.transaction(async (manager) => {
  const user = await manager.save(User, { email: 'grace@example.com', name: 'Grace' })
  await manager.save(Post, { author: user, title: 'First' })
})
```

```ts
// kick/db — the plain client joins the transaction its caller opened
await db.transaction(async () => {
  const user = await db
    .insertInto('users')
    .values({ email: 'grace@example.com', name: 'Grace' })
    .returningAll()
    .executeTakeFirstOrThrow()
  await db.insertInto('posts').values({ authorId: user.id, title: 'First' }).execute()
  await db.afterCommit(() => mailer.sendWelcome(user.email))
})
```

This is the biggest day-to-day difference. In TypeORM, a service that calls `this.userRepo.save()` inside someone else's transaction silently runs outside it unless you thread the `EntityManager` through. In kick/db, [transactions follow the call chain](./transactions.md#transactions-follow-the-call-chain): repositories and services holding the injected client take part automatically. `afterCommit` replaces an `afterTransactionCommit` subscriber, and only runs if the transaction commits.

### Errors and validation

```ts
// TypeORM
try {
  await repo.insert({ email, name })
} catch (err) {
  if (err instanceof QueryFailedError && (err.driverError as any).code === '23505') {
    // duplicate — and the code differs on MySQL and SQLite
  }
}
```

```ts
// kick/db
import { UniqueViolationError } from '@forinda/kickjs-db'
import { insertSchema } from '@forinda/kickjs-db/schema'

try {
  await db.insertInto('users').values({ email, name }).execute()
} catch (err) {
  if (err instanceof UniqueViolationError && err.columns.includes('email')) {
    // duplicate — same class on Postgres, MySQL and SQLite
  }
}

// Request validation from the same table — the email rule comes from `rules` above.
export const createUser = insertSchema(User.table, { omit: ['id', 'createdAt'] })
createUser.safeParse({ email: 'nope', name: 'N' }) // fails: not an email
```

Left unhandled in a KickJS route, a `UniqueViolationError` answers `409`. Pass `createUser` as a route's `body` schema and the same rules validate requests and document them in OpenAPI.

## What kick/db doesn't have (yet)

- **A unit of work.** No change tracking, no `save()` that inserts or updates for you, no cascading saves of related objects. Every statement is one you wrote.
- **Lazy relations and `eager: true`.** Ask for related rows with `with` on the query that needs them.
- **Entity listeners and subscribers.** There are no per-row lifecycle hooks; use service code, [`afterCommit`](./transactions.md#after-commit), a [`customType`](../db-extensions.md) codec to transform a value on write and read, or [query events](./events-plugins.md) to observe every statement.
- **Self-updating `updatedAt`, `@VersionColumn`, soft delete** — planned as [D.10](../roadmap.md). Until then, set `updatedAt` in your update and filter on `deletedAt` yourself.
- **`@ManyToMany` in relational reads** — [D.13](../roadmap.md). Declare the junction table and nest through it: `with: { memberships: { with: { project: true } } }`.
- **`synchronize`.** Deliberately absent — schema changes ship as migrations someone has read.

## Moving an existing TypeORM app

1. Point `kick db introspect` at the database TypeORM manages to get a schema file, and baseline the migration history so kick/db sees the current schema as applied — [Adopting on an Existing DB](./adopting.md). TypeORM's `migrations` table and kick/db's `kick_migrations` don't interact; leave TypeORM's alone until you're done.
2. Convert entities to tables one at a time, starting from the generated file. The class form keeps getter and method code: move it into the `TableBase` subclass and call `X.from(row)` where you need it.
3. Run both side by side: keep the `DataSource` for unported modules and inject the kick/db client into new ones. Behind [repositories](./repositories.md), a service doesn't care which one answers.
4. Move schema changes to `kick db generate` once the first table is ported, so there is one source of migrations, and turn `synchronize` off if it was on.
5. Replace hooks and subscribers as you port the code that relied on them — most become a line in a service, the rest `afterCommit`.

## Related

- [How kick/db Works](./concepts.md) — schema, snapshot, diff, migrations, typed client
- [Testing](./testing.md) — an in-memory database per test file, a rolled-back transaction per test
- [Queries](./queries.md), [Transactions](./transactions.md), [Errors](./errors.md)
