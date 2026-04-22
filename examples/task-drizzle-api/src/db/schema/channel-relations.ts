import { relations } from 'drizzle-orm'
import { channels } from './channels'
import { workspaces } from './workspaces'
import { projects } from './projects'
import { users } from './users'
import { channelMembers } from './channel-members'
import { messages } from './messages'

export const channelRelations = relations(channels, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [channels.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [channels.projectId],
    references: [projects.id],
  }),
  createdBy: one(users, {
    fields: [channels.createdById],
    references: [users.id],
  }),
  members: many(channelMembers),
  messages: many(messages),
}))
