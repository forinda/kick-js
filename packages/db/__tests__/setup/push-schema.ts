/** A schema with what introspection reads back differently — for push's round trip. */
import {
  boolean,
  check,
  index,
  integer,
  table,
  text,
  timestamp,
  uuid,
  varchar,
} from '@forinda/kickjs-db'

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(254).notNull().unique(),
  active: boolean().notNull().default(true),
  createdAt: timestamp().notNull().defaultNow(),
})

export const posts = table(
  'posts',
  {
    id: integer().primaryKey(),
    authorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar(200).notNull(),
    views: integer().notNull().default(0),
    body: text(),
  },
  (t) => ({
    byAuthor: index('posts_author_idx').on(t.authorId),
    positiveViews: check('posts_views_positive', 'views >= 0'),
  }),
)
