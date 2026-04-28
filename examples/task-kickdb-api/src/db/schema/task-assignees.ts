import { table, uuid, timestamp, unique } from '@forinda/kickjs-db'

import { tasks } from './tasks.ts'
import { users } from './users.ts'

export const taskAssignees = table(
  'task_assignees',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    pairUnique: unique('task_assignees_task_user_unique').on(t.taskId, t.userId),
  }),
)
