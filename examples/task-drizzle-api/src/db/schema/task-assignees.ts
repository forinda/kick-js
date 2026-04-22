import { pgTable, uuid, primaryKey } from 'drizzle-orm/pg-core'
import { tasks } from './tasks'
import { users } from './users'

export const taskAssignees = pgTable(
  'task_assignees',
  {
    taskId: uuid('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] })],
)
