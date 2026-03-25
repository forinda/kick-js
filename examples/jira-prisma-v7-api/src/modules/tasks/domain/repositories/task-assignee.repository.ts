import type { TaskAssignee } from '@/generated/prisma/client'

export type { TaskAssignee }

export interface ITaskAssigneeRepository {
  findByTask(taskId: string): Promise<TaskAssignee[]>
  add(taskId: string, userId: string): Promise<TaskAssignee>
  addMany(taskId: string, userIds: string[]): Promise<void>
  remove(taskId: string, userId: string): Promise<void>
  removeAllForTask(taskId: string): Promise<void>
}
