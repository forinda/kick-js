import type { ParsedQuery } from '@forinda/kickjs'
import type { tasks } from '@/db/schema'

export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert

export interface ITaskRepository {
  findById(id: string): Promise<Task | null>
  findByProject(projectId: string): Promise<Task[]>
  findPaginated(parsed: ParsedQuery, projectId?: string): Promise<{ data: Task[]; total: number }>
  findSubtasks(parentTaskId: string): Promise<Task[]>
  create(dto: NewTask): Promise<Task>
  update(id: string, dto: Partial<NewTask>): Promise<Task>
  delete(id: string): Promise<void>
}

export const TASK_REPOSITORY = Symbol('ITaskRepository')
