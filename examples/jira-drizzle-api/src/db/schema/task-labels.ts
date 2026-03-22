import { pgTable, uuid, primaryKey } from 'drizzle-orm/pg-core'
import { tasks } from './tasks'
import { labels } from './labels'

export const taskLabels = pgTable(
  'task_labels',
  {
    taskId: uuid('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    labelId: uuid('label_id')
      .references(() => labels.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] })],
)
