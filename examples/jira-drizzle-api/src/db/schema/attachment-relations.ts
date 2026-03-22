import { relations } from 'drizzle-orm'
import { attachments } from './attachments'
import { tasks } from './tasks'
import { users } from './users'

export const attachmentRelations = relations(attachments, ({ one }) => ({
  task: one(tasks, {
    fields: [attachments.taskId],
    references: [tasks.id],
  }),
  uploader: one(users, {
    fields: [attachments.uploaderId],
    references: [users.id],
  }),
}))
