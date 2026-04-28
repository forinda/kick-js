import { table, uuid, text, jsonb, timestamp, index } from '@forinda/kickjs-db'

import { tasks } from './tasks.ts'
import { users } from './users.ts'

export const comments = table(
  'comments',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid()
      .notNull()
      .references(() => users.id),
    content: text().notNull(),
    mentions: jsonb<string[]>().notNull().default(`'[]'::jsonb`),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index('comments_task_idx').on(t.taskId),
    authorIdx: index('comments_author_idx').on(t.authorId),
  }),
)
