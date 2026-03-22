import { relations } from 'drizzle-orm'
import { workspaceMembers } from './workspace-members'
import { workspaces } from './workspaces'
import { users } from './users'

export const workspaceMemberRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [workspaceMembers.userId],
    references: [users.id],
  }),
}))
