import { relations } from 'drizzle-orm'
import { channelMembers } from './channel-members'
import { channels } from './channels'
import { users } from './users'

export const channelMemberRelations = relations(channelMembers, ({ one }) => ({
  channel: one(channels, {
    fields: [channelMembers.channelId],
    references: [channels.id],
  }),
  user: one(users, {
    fields: [channelMembers.userId],
    references: [users.id],
  }),
}))
