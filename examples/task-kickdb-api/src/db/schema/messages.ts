import { table, uuid, text, jsonb, boolean, timestamp, index } from '@forinda/kickjs-db'

import { channels } from './channels.ts'
import { users } from './users.ts'

export const messages = table(
  'messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    channelId: uuid()
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    senderId: uuid()
      .notNull()
      .references(() => users.id),
    content: text().notNull(),
    mentions: jsonb<string[]>().notNull().default(`'[]'::jsonb`),
    isEdited: boolean().notNull().default('false'),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    channelIdx: index('messages_channel_idx').on(t.channelId),
    senderIdx: index('messages_sender_idx').on(t.senderId),
  }),
)
