// C — TableBase classes, exported as classes (discovery now unwraps them).
// selfRef for the self-reference, link() for the cycle.
import {
  fk,
  index,
  integer,
  link,
  relations,
  selfRef,
  serial,
  TableBase,
  text,
  timestamptz,
  uuid,
  varchar,
} from '../../../../src/index'
import { pgEnum } from '../../../../src/dsl/columns/pg'

export const postStatus = pgEnum('post_status', 'draft', 'published')

export class User extends TableBase('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(120).notNull().unique(),
  name: text(),
  featuredPostId: integer(),
  createdAt: timestamptz().notNull().defaultNow(),
}) {
  get domain() {
    return this.email.split('@')[1]
  }
}

export class Category extends TableBase('categories', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar(80).notNull(),
  parentId: uuid().references(selfRef('id')),
}) {}

export class Post extends TableBase(
  'posts',
  {
    id: serial().primaryKey(),
    authorId: fk(uuid().notNull(), () => User.table.id, { onDelete: 'cascade' }),
    categoryId: fk(uuid(), () => Category.table.id),
    status: postStatus().notNull().default('draft'),
    title: varchar(200).notNull(),
  },
  { indexes: (t) => ({ byAuthor: index('posts_author').on(t.authorId) }) },
) {}

link(User.table.featuredPostId, () => Post.table.id)

export const usersRelations = relations(User.table, (h) => ({ posts: h.many(Post.table) }))
export const postsRelations = relations(Post.table, (h) => ({
  author: h.one(User.table, { fields: [Post.table.authorId], references: [User.table.id] }),
}))
