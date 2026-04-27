// @forinda/kickjs-db M0 spike schema.
// `kick db generate <name>` diffs this against the latest committed snapshot
// and emits Postgres up.sql + snapshot.json + meta.json under db/migrations/.

import {
  table,
  relations,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  boolean,
  index,
  unique,
} from '@forinda/kickjs-db'

export const users = table(
  'users',
  {
    id: serial().primaryKey(),
    email: varchar(255).notNull().unique(),
    name: varchar(120),
    createdAt: timestamp().defaultNow().notNull(),
    isActive: boolean().notNull().default('true'),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
  }),
)

export const posts = table(
  'posts',
  {
    id: serial().primaryKey(),
    authorId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar(200).notNull(),
    body: text().notNull(),
    publishedAt: timestamp(),
  },
  (t) => ({
    authorIdx: index('posts_author_idx').on(t.authorId),
    uniqueSlug: unique('posts_title_author_unique').on(t.title, t.authorId),
  }),
)

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}))

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
