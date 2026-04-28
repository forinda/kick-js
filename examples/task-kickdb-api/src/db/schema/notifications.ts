import { table, uuid, varchar, text, jsonb, boolean, timestamp, index } from '@forinda/kickjs-db'

import { users } from './users.ts'
import { notificationType } from './enums.ts'

export const notifications = table(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    recipientId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationType().notNull(),
    title: varchar(255).notNull(),
    body: text().notNull(),
    metadata: jsonb<Record<string, unknown>>().notNull().default(`'{}'::jsonb`),
    isRead: boolean().notNull().default('false'),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    recipientIdx: index('notifications_recipient_idx').on(t.recipientId),
    isReadIdx: index('notifications_recipient_read_idx').on(t.recipientId, t.isRead),
  }),
)
