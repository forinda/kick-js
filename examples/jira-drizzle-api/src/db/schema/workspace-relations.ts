import { relations } from 'drizzle-orm'
import { workspaces } from './workspaces'
import { users } from './users'
import { workspaceMembers } from './workspace-members'
import { projects } from './projects'
import { tasks } from './tasks'
import { labels } from './labels'
import { channels } from './channels'
import { activities } from './activities'

export const workspaceRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, {
    fields: [workspaces.ownerId],
    references: [users.id],
  }),
  members: many(workspaceMembers),
  projects: many(projects),
  tasks: many(tasks),
  labels: many(labels),
  channels: many(channels),
  activities: many(activities),
}))
