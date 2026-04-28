import { table, uuid, varchar, integer, text, timestamp, index } from '@forinda/kickjs-db'

import { tasks } from './tasks.ts'
import { users } from './users.ts'

export const attachments = table(
  'attachments',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    uploaderId: uuid()
      .notNull()
      .references(() => users.id),
    fileName: varchar(255).notNull(),
    fileSize: integer().notNull(),
    mimeType: varchar(100).notNull(),
    // base64 payload — fine for the example. A production system
    // would use object storage and keep a URL/key here instead.
    data: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index('attachments_task_idx').on(t.taskId),
  }),
)
