import { relations } from 'drizzle-orm'
import { projects } from './projects'
import { workspaces } from './workspaces'
import { users } from './users'
import { tasks } from './tasks'

export const projectRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [projects.workspaceId],
    references: [workspaces.id],
  }),
  lead: one(users, {
    fields: [projects.leadId],
    references: [users.id],
  }),
  tasks: many(tasks),
}))
