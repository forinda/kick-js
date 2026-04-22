import { pgTable, text, uuid, jsonb } from 'drizzle-orm/pg-core'
import { baseColumns } from './base-columns'
import { tasks } from './tasks'
import { users } from './users'

export const comments = pgTable('comments', {
  ...baseColumns(),
  taskId: uuid('task_id')
    .references(() => tasks.id, { onDelete: 'cascade' })
    .notNull(),
  authorId: uuid('author_id')
    .references(() => users.id)
    .notNull(),
  content: text('content').notNull(),
  mentions: jsonb('mentions').$type<string[]>().default([]).notNull(),
})
