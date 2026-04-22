import { relations } from 'drizzle-orm'
import { activities } from './activities'
import { workspaces } from './workspaces'
import { projects } from './projects'
import { tasks } from './tasks'
import { users } from './users'

export const activityRelations = relations(activities, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [activities.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [activities.projectId],
    references: [projects.id],
  }),
  task: one(tasks, {
    fields: [activities.taskId],
    references: [tasks.id],
  }),
  actor: one(users, {
    fields: [activities.actorId],
    references: [users.id],
  }),
}))
