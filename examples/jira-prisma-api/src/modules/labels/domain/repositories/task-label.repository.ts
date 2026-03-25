import type { TaskLabel, Label } from '@prisma/client'

export type { TaskLabel, Label }

export interface ITaskLabelRepository {
  findByTask(taskId: string): Promise<Label[]>
  add(taskId: string, labelId: string): Promise<TaskLabel>
  remove(taskId: string, labelId: string): Promise<void>
  removeAllForTask(taskId: string): Promise<void>
}

export const TASK_LABEL_REPOSITORY = Symbol('ITaskLabelRepository')
