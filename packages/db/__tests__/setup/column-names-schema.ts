/** A schema with `.dbName()` columns, and a same-named key left alone in another table. */
import { integer, relations, serial, table, text, timestamp, varchar } from '@forinda/kickjs-db'

export const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(254).notNull().unique().dbName('EMAIL_ADDR'),
  fullName: text().dbName('FULL_NM'),
  updatedAt: timestamp().notNull().defaultNow().onUpdateNow().dbName('MODIFIED'),
})
export const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id)
    .dbName('AUTHOR'),
  email: text(),
  title: text().notNull(),
})
export const userRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
export const postRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
