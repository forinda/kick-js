import { pgTable, text, uuid, jsonb, boolean } from 'drizzle-orm/pg-core'
import { baseColumns } from './base-columns'
import { channels } from './channels'
import { users } from './users'

export const messages = pgTable('messages', {
  ...baseColumns(),
  channelId: uuid('channel_id')
    .references(() => channels.id, { onDelete: 'cascade' })
    .notNull(),
  senderId: uuid('sender_id')
    .references(() => users.id)
    .notNull(),
  content: text('content').notNull(),
  mentions: jsonb('mentions').$type<string[]>().default([]).notNull(),
  isEdited: boolean('is_edited').default(false).notNull(),
})
