import { table, uuid, timestamp, unique } from '@forinda/kickjs-db'

import { channels } from './channels.ts'
import { users } from './users.ts'

export const channelMembers = table(
  'channel_members',
  {
    id: uuid().primaryKey().defaultRandom(),
    channelId: uuid()
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    pairUnique: unique('channel_members_channel_user_unique').on(t.channelId, t.userId),
  }),
)
