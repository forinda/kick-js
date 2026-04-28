// Relations for the full task-kickdb-api schema. Co-located in one
// file to avoid the per-table import-cycle problem (users.ts and
// workspaces.ts reference each other through their relations; that
// works only when the relations() declarations live outside the
// table modules themselves).

import { relations } from '@forinda/kickjs-db'

import { users } from './users.ts'
import { refreshTokens } from './refresh-tokens.ts'
import { workspaces } from './workspaces.ts'
import { workspaceMembers } from './workspace-members.ts'
import { projects } from './projects.ts'
import { tasks } from './tasks.ts'
import { taskAssignees } from './task-assignees.ts'
import { labels } from './labels.ts'
import { taskLabels } from './task-labels.ts'
import { comments } from './comments.ts'
import { attachments } from './attachments.ts'
import { channels } from './channels.ts'
import { channelMembers } from './channel-members.ts'
import { messages } from './messages.ts'
import { notifications } from './notifications.ts'
import { activities } from './activities.ts'

export const usersRelations = relations(users, ({ many }) => ({
  ownedWorkspaces: many(workspaces),
  workspaceMemberships: many(workspaceMembers),
  reportedTasks: many(tasks),
  taskAssignees: many(taskAssignees),
  comments: many(comments),
  attachments: many(attachments),
  sentMessages: many(messages),
  notifications: many(notifications),
  activities: many(activities),
  channelMemberships: many(channelMembers),
  refreshTokens: many(refreshTokens),
  createdChannels: many(channels),
}))

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}))

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, { fields: [workspaces.ownerId], references: [users.id] }),
  members: many(workspaceMembers),
  projects: many(projects),
  labels: many(labels),
  channels: many(channels),
  tasks: many(tasks),
  activities: many(activities),
}))

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
  lead: one(users, { fields: [projects.leadId], references: [users.id] }),
  tasks: many(tasks),
  channels: many(channels),
  activities: many(activities),
}))

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  workspace: one(workspaces, { fields: [tasks.workspaceId], references: [workspaces.id] }),
  reporter: one(users, { fields: [tasks.reporterId], references: [users.id] }),
  parentTask: one(tasks, { fields: [tasks.parentTaskId], references: [tasks.id] }),
  subtasks: many(tasks),
  assignees: many(taskAssignees),
  labels: many(taskLabels),
  comments: many(comments),
  attachments: many(attachments),
  activities: many(activities),
}))

export const taskAssigneesRelations = relations(taskAssignees, ({ one }) => ({
  task: one(tasks, { fields: [taskAssignees.taskId], references: [tasks.id] }),
  user: one(users, { fields: [taskAssignees.userId], references: [users.id] }),
}))

export const labelsRelations = relations(labels, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [labels.workspaceId], references: [workspaces.id] }),
  taskLabels: many(taskLabels),
}))

export const taskLabelsRelations = relations(taskLabels, ({ one }) => ({
  task: one(tasks, { fields: [taskLabels.taskId], references: [tasks.id] }),
  label: one(labels, { fields: [taskLabels.labelId], references: [labels.id] }),
}))

export const commentsRelations = relations(comments, ({ one }) => ({
  task: one(tasks, { fields: [comments.taskId], references: [tasks.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}))

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  task: one(tasks, { fields: [attachments.taskId], references: [tasks.id] }),
  uploader: one(users, { fields: [attachments.uploaderId], references: [users.id] }),
}))

export const channelsRelations = relations(channels, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [channels.workspaceId], references: [workspaces.id] }),
  project: one(projects, { fields: [channels.projectId], references: [projects.id] }),
  createdBy: one(users, { fields: [channels.createdById], references: [users.id] }),
  members: many(channelMembers),
  messages: many(messages),
}))

export const channelMembersRelations = relations(channelMembers, ({ one }) => ({
  channel: one(channels, { fields: [channelMembers.channelId], references: [channels.id] }),
  user: one(users, { fields: [channelMembers.userId], references: [users.id] }),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  channel: one(channels, { fields: [messages.channelId], references: [channels.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, { fields: [notifications.recipientId], references: [users.id] }),
}))

export const activitiesRelations = relations(activities, ({ one }) => ({
  workspace: one(workspaces, { fields: [activities.workspaceId], references: [workspaces.id] }),
  project: one(projects, { fields: [activities.projectId], references: [projects.id] }),
  task: one(tasks, { fields: [activities.taskId], references: [tasks.id] }),
  actor: one(users, { fields: [activities.actorId], references: [users.id] }),
}))
