import { relations } from 'drizzle-orm'
import { notifications } from './notifications'
import { users } from './users'

export const notificationRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, {
    fields: [notifications.recipientId],
    references: [users.id],
  }),
}))
