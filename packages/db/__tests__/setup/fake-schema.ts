/** A schema with what seed data has to respect: keys, uniques, FKs, a junction, lengths. */
import {
  boolean,
  customType,
  decimal,
  integer,
  primaryKey,
  serial,
  table,
  text,
  timestamp,
  uuid,
  varchar,
} from '@forinda/kickjs-db'

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(60).notNull().unique(),
  name: varchar(12).notNull(),
  active: boolean().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
})

export const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar(200).notNull(),
  body: text(),
  views: integer().notNull().default(0),
  price: decimal(8, 2).notNull(),
  publishedAt: timestamp(),
})

export const tags = table('tags', {
  id: serial().primaryKey(),
  name: varchar(40).notNull().unique(),
})

export const postTags = table(
  'post_tags',
  {
    postId: integer()
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    tagId: integer()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey().on(t.postId, t.tagId) }),
)

const labelList = customType<string[]>({
  dataType: () => 'text',
  toDriver: (v) => JSON.stringify(v),
  fromDriver: (v) => JSON.parse(v as string) as string[],
})
/** A custom type with no default: seed data can't guess it. */
export const notes = table('notes', { id: serial().primaryKey(), labels: labelList().notNull() })
