/**
 * Create Task Use Case
 *
 * Application layer — orchestrates a single business operation.
 * Use cases are thin: validate input (via DTO), call domain/repo, return response.
 * Keep business rules in the domain service, not here.
 */
import { Service, Inject } from '@forinda/kickjs'
import { TASK_REPOSITORY, type ITaskRepository } from '../../domain/repositories/task.repository'
import type { CreateTaskDTO } from '../dtos/create-task.dto'
import type { TaskResponseDTO } from '../dtos/task-response.dto'

@Service()
export class CreateTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly repo: ITaskRepository,
  ) {}

  async execute(dto: CreateTaskDTO): Promise<TaskResponseDTO> {
    return this.repo.create(dto)
  }
}
