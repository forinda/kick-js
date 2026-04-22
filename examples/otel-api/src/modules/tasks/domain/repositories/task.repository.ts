/**
 * Task Repository Interface
 *
 * Domain layer — defines the contract for data access.
 * The interface lives in the domain layer; implementations live in infrastructure.
 * This inversion of dependencies keeps the domain pure and testable.
 *
 * To swap implementations (e.g. in-memory -> Drizzle -> Prisma),
 * change the factory in the module's register() method.
 */
import type { TaskResponseDTO } from '../../application/dtos/task-response.dto'
import type { CreateTaskDTO } from '../../application/dtos/create-task.dto'
import type { UpdateTaskDTO } from '../../application/dtos/update-task.dto'
import type { ParsedQuery } from '@forinda/kickjs'

export interface ITaskRepository {
  findById(id: string): Promise<TaskResponseDTO | null>
  findAll(): Promise<TaskResponseDTO[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: TaskResponseDTO[]; total: number }>
  create(dto: CreateTaskDTO): Promise<TaskResponseDTO>
  update(id: string, dto: UpdateTaskDTO): Promise<TaskResponseDTO>
  delete(id: string): Promise<void>
}

export const TASK_REPOSITORY = Symbol('ITaskRepository')
