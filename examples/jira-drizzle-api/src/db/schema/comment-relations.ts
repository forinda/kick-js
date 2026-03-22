import { relations } from 'drizzle-orm'
import { comments } from './comments'
import { tasks } from './tasks'
import { users } from './users'

export const commentRelations = relations(comments, ({ one }) => ({
  task: one(tasks, {
    fields: [comments.taskId],
    references: [tasks.id],
  }),
  author: one(users, {
    fields: [comments.authorId],
    references: [users.id],
  }),
}))
