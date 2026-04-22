import { relations } from 'drizzle-orm'
import { messages } from './messages'
import { channels } from './channels'
import { users } from './users'

export const messageRelations = relations(messages, ({ one }) => ({
  channel: one(channels, {
    fields: [messages.channelId],
    references: [channels.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
  }),
}))
