import type { taskAssignees } from '@/db/schema'

export type TaskAssignee = typeof taskAssignees.$inferSelect
export type NewTaskAssignee = typeof taskAssignees.$inferInsert

export interface ITaskAssigneeRepository {
  findByTask(taskId: string): Promise<TaskAssignee[]>
  add(taskId: string, userId: string): Promise<TaskAssignee>
  addMany(taskId: string, userIds: string[]): Promise<void>
  remove(taskId: string, userId: string): Promise<void>
  removeAllForTask(taskId: string): Promise<void>
}
