// D — defineTable. The column callback for the self-reference (key and type
// checked), link() for the cycle.
import {
  index,
  integer,
  relations,
  serial,
  text,
  timestamptz,
  uuid,
  varchar,
} from '../../../../src/index'
import { pgEnum } from '../../../../src/dsl/columns/pg'
import { defineTable, fk, link } from '../../../../src/class-table'

export const postStatus = pgEnum('post_status', 'draft', 'published')

export const users = defineTable('users')
  .column('id', uuid().primaryKey().defaultRandom())
  .column('email', varchar(120).notNull().unique())
  .column('name', text())
  .column('featuredPostId', integer())
  .column('createdAt', timestamptz().notNull().defaultNow())
  .build()

export const categories = defineTable('categories')
  .column('id', uuid().primaryKey().defaultRandom())
  .column('name', varchar(80).notNull())
  .column('parentId', (t) => fk(uuid(), () => t.id))
  .build()

export const posts = defineTable('posts')
  .column('id', serial().primaryKey())
  .column(
    'authorId',
    fk(uuid().notNull(), () => users.id, { onDelete: 'cascade' }),
  )
  .column(
    'categoryId',
    fk(uuid(), () => categories.id),
  )
  .column('status', postStatus().notNull().default('draft'))
  .column('title', varchar(200).notNull())
  .index((t) => ({ byAuthor: index('posts_author').on(t.authorId) }))
  .build()

link(users.featuredPostId, () => posts.id)

export const usersRelations = relations(users, (h) => ({ posts: h.many(posts) }))
export const postsRelations = relations(posts, (h) => ({
  author: h.one(users, { fields: [posts.authorId], references: [users.id] }),
}))
