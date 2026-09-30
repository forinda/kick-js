// A — @Table / @Column. Thunks to tableOf(...) need no annotation, but the
// tables are untyped (a decorator can't give its builder's type to the class).
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
import { Column, Table, tableOf } from '../../../../src/class-table'

export const postStatus = pgEnum('post_status', 'draft', 'published')

@Table('users')
class User {
  @Column(uuid().primaryKey().defaultRandom()) id!: string
  @Column(varchar(120).notNull().unique()) email!: string
  @Column(text()) name!: string | null
  @Column(integer().references(() => tableOf(Post).id)) featuredPostId!: number | null
  @Column(timestamptz().notNull().defaultNow()) createdAt!: Date
}

@Table('categories')
class Category {
  @Column(uuid().primaryKey().defaultRandom()) id!: string
  @Column(varchar(80).notNull()) name!: string
  @Column(uuid().references(() => tableOf(Category).id)) parentId!: string | null
}

@Table('posts')
class Post {
  @Column(serial().primaryKey()) id!: number
  @Column(
    uuid()
      .notNull()
      .references(() => tableOf(User).id, { onDelete: 'cascade' }),
  )
  authorId!: string
  @Column(uuid().references(() => tableOf(Category).id)) categoryId!: string | null
  @Column(postStatus().notNull().default('draft')) status!: 'draft' | 'published'
  @Column(varchar(200).notNull()) title!: string
}

// No class-level place for indexes in this form yet — the snapshot differs here.
void index

export const users = tableOf(User)
export const categories = tableOf(Category)
export const posts = tableOf(Post)

export const usersRelations = relations(users, (h) => ({ posts: h.many(posts) }))
export const postsRelations = relations(posts, (h) => ({
  author: h.one(users, { fields: [posts.authorId], references: [users.id] }),
}))
