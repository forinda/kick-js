import { pgTable, varchar, text, uuid, integer, timestamp } from 'drizzle-orm/pg-core'
import { tasks } from './tasks'
import { users } from './users'

export const attachments = pgTable('attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id')
    .references(() => tasks.id, { onDelete: 'cascade' })
    .notNull(),
  uploaderId: uuid('uploader_id')
    .references(() => users.id)
    .notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  data: text('data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
