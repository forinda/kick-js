# Relations

Relations tell `db.query` how your tables connect, so `with: { author: true }` can load a post's author in the same query. They only shape reads: the foreign keys, unique keys and junction tables that make the data correct are declared on the tables themselves ([Keys & Constraints](./constraints.md)).

This page builds one small blog and adds each kind of relation to it. Every query result shown here is what the query returns.

## Which one do I need?

Ask two questions about the link between two tables.

**1. For one row here, how many rows can there be on the other side?** At most one means a `one` (or `morphOne` / `morphTo`); any number means a `many` (or `morphMany`).

**2. Where does the key live?**

- **A column on one of the two tables** (`posts.authorId`): `one` and `many`.
- **A third table of pairs** (`post_tags`): `many(…, { through })`.
- **A type + id column pair, with no foreign key** (`comments.subjectType` + `subjectId`): the `morph*` helpers.

| Shape                   | Question it answers                       | Key                                  | Helper                                 |
| ----------------------- | ----------------------------------------- | ------------------------------------ | -------------------------------------- |
| Many-to-one (m:1)       | Who wrote this post?                      | `posts.authorId`, on this table      | `one`                                  |
| One-to-many (1:m)       | Which posts did this user write?          | `posts.authorId`, on the other       | `many`                                 |
| One-to-one (1:1)        | What's this user's profile?               | `profiles.userId`, unique            | `one`, on both tables                  |
| Many-to-many (m:n)      | Which tags does this post have?           | the `post_tags` junction table       | `many(…, { through })`, on both tables |
| Polymorphic one-to-many | Which comments does this post have?       | `comments.subjectType` + `subjectId` | `morphMany`                            |
| Polymorphic one-to-one  | What's this post's cover image?           | `images.subjectType` + `subjectId`   | `morphOne`                             |
| Polymorphic many-to-one | What is this comment on, post or podcast? | the same pair, on this table         | `morphTo`                              |

Many-to-one and one-to-many are the same link read from its two ends. Declare a relation on each table you want to read from.

## The tables

```ts
import {
  index,
  integer,
  primaryKey,
  relations,
  serial,
  table,
  text,
  unique,
  varchar,
} from '@forinda/kickjs-db'

export const users = table('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
})

export const profiles = table('profiles', {
  id: serial().primaryKey(),
  userId: integer()
    .notNull()
    .unique() // one profile per user
    .references(() => users.id),
  bio: text().notNull(),
})

export const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id), // many posts per user
  title: text().notNull(),
})

export const tags = table('tags', { id: serial().primaryKey(), name: text().notNull() })

// One row per (post, tag) pair.
export const postTags = table(
  'post_tags',
  {
    postId: integer()
      .notNull()
      .references(() => posts.id),
    tagId: integer()
      .notNull()
      .references(() => tags.id),
  },
  (t) => ({ pk: primaryKey().on(t.postId, t.tagId) }),
)

export const podcasts = table('podcasts', { id: serial().primaryKey(), title: text().notNull() })

// Comments on posts *and* podcasts: which kind, and which row.
export const comments = table(
  'comments',
  {
    id: serial().primaryKey(),
    subjectType: varchar(50).notNull(), // 'post' | 'podcast'
    subjectId: integer().notNull(),
    body: text().notNull(),
  },
  (t) => ({ subject: index('comments_subject_idx').on(t.subjectType, t.subjectId) }),
)

// Cover images, stored the same way: at most one per post or podcast.
export const images = table(
  'images',
  {
    id: serial().primaryKey(),
    subjectType: varchar(50).notNull(),
    subjectId: integer().notNull(),
    url: text().notNull(),
  },
  (t) => ({ subject: unique('images_subject_unique').on(t.subjectType, t.subjectId) }),
)
```

The data the examples read: Ada wrote two posts, _Hello_ and _Indexes_. Linus wrote none and has no profile. _Hello_ is tagged `intro` and `sql`, has two comments and a cover image. The podcast _Weekly_ has one comment.

## Many-to-one: `one`, on the table with the key

Each post has exactly one author, and the key that says who, `posts.authorId`, is on `posts`. So the post side declares `one`:

```ts
export const postRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
```

Read it as "`posts.authorId` equals `users.id`": `fields` are columns of the table you declare on, `references` the target's columns they equal.

```ts
await db.query.posts.findFirst({
  where: (_p, eb) => eb('id', '=', 1),
  columns: { title: true },
  with: { author: { columns: { name: true } } },
})
// { title: 'Hello', author: { name: 'Ada' } }
```

`author` is typed as a user or `null`. Here it's never `null`, because `authorId` is `notNull()` and references a real user. A nullable key gives `null` for a post without one.

## One-to-many: `many`, on the table without the key

The same link from the user's end: a user has any number of posts, and `users` holds no key for them. The user side declares `many`:

```ts
export const userRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}))
```

`many` takes no columns. It finds the join from the `one` you declared on `posts` (`author`), or, without one, from the foreign key `posts.authorId`.

```ts
await db.query.users.findMany({
  columns: { name: true },
  with: { posts: { columns: { title: true }, orderBy: (_p, eb) => eb.ref('id') } },
})
// [
//   { name: 'Ada', posts: [{ title: 'Hello' }, { title: 'Indexes' }] },
//   { name: 'Linus', posts: [] },
// ]
```

A user with no posts gets `[]`, never `null`.

## One-to-one: `one`, on both tables

A user has at most one profile, and a profile belongs to exactly one user. Structurally this is many-to-one with one extra rule: the key, `profiles.userId`, is `unique()`. That rule is what makes it one-to-one. Without it the database would accept a second profile for the same user, and `one` would quietly read only one of them.

Both sides are `one`, and the join is the same pair of columns written from each end:

```ts
export const profileRelations = relations(profiles, ({ one }) => ({
  // On the table with the key: like any many-to-one.
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
}))

export const userRelations = relations(users, ({ one, many }) => ({
  posts: many(posts),
  // On the other table: your own key in `fields`, the child's in `references`.
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
}))
```

```ts
await db.query.users.findMany({
  columns: { name: true },
  with: { profile: { columns: { bio: true } } },
})
// [
//   { name: 'Ada', profile: { bio: 'Writes about engines' } },
//   { name: 'Linus', profile: null },
// ]
```

Put the key on the side that is created second or is optional. A profile can't exist without its user, so `profiles` holds `userId`.

## Many-to-many: `many` through a junction table

A post has many tags, and a tag is on many posts. Neither table can hold the key, because neither side has just one. A junction table, `post_tags`, holds one row per pair, and both sides read through it:

```ts
export const postRelations = relations(posts, ({ many }) => ({
  tags: many(tags, { through: postTags }),
}))
export const tagRelations = relations(tags, ({ many }) => ({
  posts: many(posts, { through: postTags }),
}))
```

```ts
await db.query.posts.findFirst({
  where: (_p, eb) => eb('id', '=', 1),
  columns: { title: true },
  with: { tags: { columns: { name: true } } },
})
// { title: 'Hello', tags: [{ name: 'intro' }, { name: 'sql' }] }

await db.query.tags.findFirst({
  where: (_t, eb) => eb('name', '=', 'sql'),
  columns: { name: true },
  with: { posts: { columns: { title: true } } },
})
// { name: 'sql', posts: [{ title: 'Hello' }, { title: 'Indexes' }] }
```

The junction rows themselves aren't returned. To read a column on the junction (when a tag was added, a member's role), declare the junction as an ordinary table between the two, with a `many` to it and a `one` from it, and read `with: { postTags: { with: { tag: true } } }`. A junction with two keys to the same table, like followers, is in [Relational Queries](../db-relational-query.md#many-to-many).

## Polymorphic: one table, several kinds of parent

Comments go on posts and on podcasts. Instead of a key column per parent, each comment stores which kind of parent it has (`subjectType`) and that parent's id (`subjectId`). Adding a new kind of parent needs no migration. The price is that the database can't check the pair: there's no foreign key, so no cascade, and nothing stops a `subjectId` that points nowhere. [Relational Queries](../db-relational-query.md#polymorphic-associations) compares this with the two layouts that keep foreign keys.

The three `morph*` helpers are the type + id versions of the plain ones:

| Plain                                  | Polymorphic | Declared on       | Reads as              |
| -------------------------------------- | ----------- | ----------------- | --------------------- |
| `many` (one-to-many)                   | `morphMany` | each parent table | an array of children  |
| `one`, on the parent side (one-to-one) | `morphOne`  | each parent table | one child, or `null`  |
| `one`, on the key side (many-to-one)   | `morphTo`   | the child, once   | its parent, or `null` |

`morphMany` and `morphOne` go on the parent and take the `as` value that marks rows belonging to that parent. `morphTo` goes on the child and maps each type value to a table.

### `morphMany`: a post's comments

```ts
export const postRelations = relations(posts, ({ morphMany }) => ({
  comments: morphMany(comments, { type: comments.subjectType, id: comments.subjectId, as: 'post' }),
}))
export const podcastRelations = relations(podcasts, ({ morphMany }) => ({
  comments: morphMany(comments, {
    type: comments.subjectType,
    id: comments.subjectId,
    as: 'podcast',
  }),
}))
```

`as: 'post'` reads only the comments whose `subjectType` is `'post'` and whose `subjectId` is this post's id. The podcast's comment, which also has `subjectId: 1`, stays out:

```ts
await db.query.posts.findFirst({
  where: (_p, eb) => eb('id', '=', 1),
  columns: { title: true },
  with: { comments: { columns: { body: true } } },
})
// { title: 'Hello', comments: [{ body: 'Nice' }, { body: 'Agreed' }] }
```

### `morphOne`: a post's cover image

The same pair, for at most one child:

```ts
export const postRelations = relations(posts, ({ morphOne }) => ({
  cover: morphOne(images, { type: images.subjectType, id: images.subjectId, as: 'post' }),
}))
```

```ts
await db.query.posts.findMany({
  columns: { title: true },
  with: { cover: { columns: { url: true } } },
})
// [
//   { title: 'Hello', cover: { url: '/hello.png' } },
//   { title: 'Indexes', cover: null },
// ]
```

The unique key on `(subjectType, subjectId)` makes it one-to-one: the database refuses a second cover for the same post, as `unique()` on `profiles.userId` does for profiles. If your design allows several rows per parent and you want just one of them, leave the key out and choose with `orderBy`: `with: { cover: { orderBy: (_i, eb) => desc(eb.ref('id')) } }` reads the newest.

### `morphTo`: a comment's subject, whichever kind

From the child back to its parent. The parent can be in any of several tables, so `targets` maps each type value to its table:

```ts
export const commentRelations = relations(comments, ({ morphTo }) => ({
  subject: morphTo({
    type: comments.subjectType,
    id: comments.subjectId,
    targets: { post: posts, podcast: podcasts },
  }),
}))
```

```ts
await db.query.comments.findMany({ columns: { body: true }, with: { subject: true } })
// [
//   { body: 'Nice', subject: { id: 1, authorId: 1, title: 'Hello', __type: 'post' } },
//   { body: 'Great episode', subject: { id: 1, title: 'Weekly', __type: 'podcast' } },
//   { body: 'Agreed', subject: { id: 1, authorId: 1, title: 'Hello', __type: 'post' } },
// ]
```

Each subject carries `__type`, the type value it was found by. Checking it narrows the type: after `if (c.subject?.__type === 'post')`, `c.subject` is a post. Per-target options (`columns`, `where`, nested `with`) are in [Relational Queries](../db-relational-query.md#type-and-id-columns-morphmany-morphone-morphto).

## Common mistakes

- **`many` with nothing to join on.** `many(posts)` needs a `one` back to this table on `posts`, or a foreign key there. With neither, creating the client throws `RelationalQueryMissingInverseError`.
- **Two keys to the same table.** A message with `senderId` and `recipientId`, both to `users`, gives `many(messages)` two possible joins. Give each `one` a `relationName` and the matching `many` the same one ([Tables & Columns](./schema.md#relations-for-db-query)).
- **One-to-one without `unique()`.** It works until a second row appears, and then reads one of them. The unique key is what makes it one-to-one.
- **`fields` and `references` crossed.** `fields` are always columns of the table you're declaring on. On the parent side of a one-to-one that's your own `id`, not the child's key.
- **`morphOne` versus `morphTo`.** Both read one row. `morphOne` goes on the parent and reads its child (a post's cover). `morphTo` goes on the child and reads its parent (a comment's post or podcast).
- **Expecting a relation to create a column or constraint.** Relations emit no DDL. `kick db generate` sees only the tables.
