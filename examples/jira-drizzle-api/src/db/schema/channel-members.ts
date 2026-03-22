import { pgTable, uuid, primaryKey } from 'drizzle-orm/pg-core'
import { channels } from './channels'
import { users } from './users'

export const channelMembers = pgTable(
  'channel_members',
  {
    channelId: uuid('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] })],
)
