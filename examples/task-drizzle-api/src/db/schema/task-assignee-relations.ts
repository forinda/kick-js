import { relations } from 'drizzle-orm'
import { taskAssignees } from './task-assignees'
import { tasks } from './tasks'
import { users } from './users'

export const taskAssigneeRelations = relations(taskAssignees, ({ one }) => ({
  task: one(tasks, {
    fields: [taskAssignees.taskId],
    references: [tasks.id],
  }),
  user: one(users, {
    fields: [taskAssignees.userId],
    references: [users.id],
  }),
}))
