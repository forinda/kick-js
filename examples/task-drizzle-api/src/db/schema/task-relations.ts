import { relations } from 'drizzle-orm'
import { tasks } from './tasks'
import { projects } from './projects'
import { workspaces } from './workspaces'
import { users } from './users'
import { taskAssignees } from './task-assignees'
import { taskLabels } from './task-labels'
import { comments } from './comments'
import { attachments } from './attachments'

export const taskRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [tasks.workspaceId],
    references: [workspaces.id],
  }),
  reporter: one(users, {
    fields: [tasks.reporterId],
    references: [users.id],
    relationName: 'reporter',
  }),
  parentTask: one(tasks, {
    fields: [tasks.parentTaskId],
    references: [tasks.id],
    relationName: 'subtasks',
  }),
  subtasks: many(tasks, { relationName: 'subtasks' }),
  assignees: many(taskAssignees),
  labels: many(taskLabels),
  comments: many(comments),
  attachments: many(attachments),
}))
