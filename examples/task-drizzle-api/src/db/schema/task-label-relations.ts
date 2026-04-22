import { relations } from 'drizzle-orm'
import { taskLabels } from './task-labels'
import { tasks } from './tasks'
import { labels } from './labels'

export const taskLabelRelations = relations(taskLabels, ({ one }) => ({
  task: one(tasks, {
    fields: [taskLabels.taskId],
    references: [tasks.id],
  }),
  label: one(labels, {
    fields: [taskLabels.labelId],
    references: [labels.id],
  }),
}))
