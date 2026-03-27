import { Service, Inject } from '@forinda/kickjs-core'
import { TASK_REPOSITORY, type ITaskRepository } from '../../domain/repositories/task.repository'
import type { UpdateTaskDTO } from '../dtos/update-task.dto'
import type { TaskResponseDTO } from '../dtos/task-response.dto'

@Service()
export class UpdateTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly repo: ITaskRepository,
  ) {}

  async execute(id: string, dto: UpdateTaskDTO): Promise<TaskResponseDTO> {
    return this.repo.update(id, dto)
  }
}
