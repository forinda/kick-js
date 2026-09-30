// O — table(), with the core fixes: selfRef, typed fk(), link() for the cycle.
// No `(): ColumnRef =>` annotations anywhere.
import {
  fk,
  index,
  integer,
  link,
  relations,
  selfRef,
  serial,
  table,
  text,
  timestamptz,
  uuid,
  varchar,
} from '../../../../src/index'
import { pgEnum } from '../../../../src/dsl/columns/pg'

export const postStatus = pgEnum('post_status', 'draft', 'published')

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(120).notNull().unique(),
  name: text(),
  featuredPostId: integer(),
  createdAt: timestamptz().notNull().defaultNow(),
})

export const categories = table('categories', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar(80).notNull(),
  parentId: uuid().references(selfRef('id')),
})

export const posts = table(
  'posts',
  {
    id: serial().primaryKey(),
    authorId: fk(uuid().notNull(), () => users.id, { onDelete: 'cascade' }),
    categoryId: fk(uuid(), () => categories.id),
    status: postStatus().notNull().default('draft'),
    title: varchar(200).notNull(),
  },
  (t) => ({ byAuthor: index('posts_author').on(t.authorId) }),
)

// users ↔ posts: wired after both exist, so neither initializer names the other.
link(users.featuredPostId, () => posts.id)

export const usersRelations = relations(users, (h) => ({ posts: h.many(posts) }))
export const postsRelations = relations(posts, (h) => ({
  author: h.one(users, { fields: [posts.authorId], references: [users.id] }),
}))
