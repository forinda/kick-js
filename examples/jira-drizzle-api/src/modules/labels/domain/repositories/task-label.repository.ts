import type { taskLabels, labels } from '@/db/schema'

export type TaskLabel = typeof taskLabels.$inferSelect
export type Label = typeof labels.$inferSelect

export interface ITaskLabelRepository {
  findByTask(taskId: string): Promise<Label[]>
  add(taskId: string, labelId: string): Promise<TaskLabel>
  remove(taskId: string, labelId: string): Promise<void>
  removeAllForTask(taskId: string): Promise<void>
}

export const TASK_LABEL_REPOSITORY = Symbol('ITaskLabelRepository')
