import type { ParsedQuery } from '@forinda/kickjs-http'
import type { Task } from '@prisma/client'

export type { Task }
export type NewTask = {
  projectId: string
  workspaceId: string
  key: string
  title: string
  description?: string | null
  status?: string
  priority?: any
  reporterId: string
  parentTaskId?: string | null
  dueDate?: Date | null
  estimatePoints?: number | null
  orderIndex?: number
}

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
