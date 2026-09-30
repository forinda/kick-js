// B — builder fields. Plain thunks for the self-reference and the cycle:
// the class body breaks TypeScript's inference loop, so no annotation.
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
import { tableFromClass, type ClassRefs } from '../../../../src/class-table'

export const postStatus = pgEnum('post_status', 'draft', 'published')

class Users {
  static readonly tableName = 'users'
  id = uuid().primaryKey().defaultRandom()
  email = varchar(120).notNull().unique()
  name = text()
  featuredPostId = integer().references(() => posts.id)
  createdAt = timestamptz().notNull().defaultNow()
}
export const users = tableFromClass(Users)

class Categories {
  static readonly tableName = 'categories'
  id = uuid().primaryKey().defaultRandom()
  name = varchar(80).notNull()
  parentId = uuid().references(() => categories.id)
}
export const categories = tableFromClass(Categories)

class Posts {
  static readonly tableName = 'posts'
  static readonly indexes = (t: ClassRefs<typeof Posts>) => ({
    byAuthor: index('posts_author').on(t.authorId),
  })
  id = serial().primaryKey()
  authorId = uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
  categoryId = uuid().references(() => categories.id)
  status = postStatus().notNull().default('draft')
  title = varchar(200).notNull()
}
export const posts = tableFromClass(Posts)

export const usersRelations = relations(users, (h) => ({ posts: h.many(posts) }))
export const postsRelations = relations(posts, (h) => ({
  author: h.one(users, { fields: [posts.authorId], references: [users.id] }),
}))
