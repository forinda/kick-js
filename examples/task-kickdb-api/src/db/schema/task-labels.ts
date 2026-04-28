import { table, uuid, timestamp, unique } from '@forinda/kickjs-db'

import { tasks } from './tasks.ts'
import { labels } from './labels.ts'

export const taskLabels = table(
  'task_labels',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid()
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    appliedAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    pairUnique: unique('task_labels_task_label_unique').on(t.taskId, t.labelId),
  }),
)
