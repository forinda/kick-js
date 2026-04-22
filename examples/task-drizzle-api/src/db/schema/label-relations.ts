import { relations } from 'drizzle-orm'
import { labels } from './labels'
import { workspaces } from './workspaces'
import { taskLabels } from './task-labels'

export const labelRelations = relations(labels, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [labels.workspaceId],
    references: [workspaces.id],
  }),
  taskLabels: many(taskLabels),
}))
