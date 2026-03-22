import { pgTable, varchar, text, uuid, integer, timestamp } from 'drizzle-orm/pg-core'
import { baseColumns } from './base-columns'
import { taskPriorityEnum } from './enums'
import { users } from './users'
import { workspaces } from './workspaces'
import { projects } from './projects'

export const tasks = pgTable('tasks', {
  ...baseColumns(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  workspaceId: uuid('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .notNull(),
  key: varchar('key', { length: 20 }).unique().notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 }).default('todo').notNull(),
  priority: taskPriorityEnum('priority').default('none').notNull(),
  reporterId: uuid('reporter_id')
    .references(() => users.id)
    .notNull(),
  parentTaskId: uuid('parent_task_id'),
  dueDate: timestamp('due_date'),
  estimatePoints: integer('estimate_points'),
  orderIndex: integer('order_index').default(0).notNull(),
  attachmentCount: integer('attachment_count').default(0).notNull(),
  commentCount: integer('comment_count').default(0).notNull(),
})
