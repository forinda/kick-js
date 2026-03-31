import { z } from 'zod'

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
})

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  completed: z.boolean().optional(),
})

export type CreateTaskDto = z.infer<typeof CreateTaskSchema>
export type UpdateTaskDto = z.infer<typeof UpdateTaskSchema>

export interface Task {
  id: string
  title: string
  description?: string
  completed: boolean
  createdAt: Date
  updatedAt: Date
}

export const TASK_REPOSITORY = Symbol('TaskRepository')

export interface ITaskRepository {
  findAll(): Promise<Task[]>
  findById(id: string): Promise<Task | null>
  create(dto: CreateTaskDto): Promise<Task>
  update(id: string, dto: UpdateTaskDto): Promise<Task | null>
  delete(id: string): Promise<boolean>
}
