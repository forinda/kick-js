import { relations } from 'drizzle-orm'
import { users } from './users'
import { workspaces } from './workspaces'
import { workspaceMembers } from './workspace-members'
import { tasks } from './tasks'
import { taskAssignees } from './task-assignees'
import { comments } from './comments'
import { attachments } from './attachments'
import { channels } from './channels'
import { channelMembers } from './channel-members'
import { messages } from './messages'
import { notifications } from './notifications'
import { activities } from './activities'
import { refreshTokens } from './refresh-tokens'

export const userRelations = relations(users, ({ many }) => ({
  ownedWorkspaces: many(workspaces),
  workspaceMembers: many(workspaceMembers),
  reportedTasks: many(tasks, { relationName: 'reporter' }),
  taskAssignees: many(taskAssignees),
  comments: many(comments),
  attachments: many(attachments),
  createdChannels: many(channels),
  channelMembers: many(channelMembers),
  messages: many(messages),
  notifications: many(notifications),
  activities: many(activities),
  refreshTokens: many(refreshTokens),
}))
