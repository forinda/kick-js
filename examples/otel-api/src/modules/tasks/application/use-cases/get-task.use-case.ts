import { Service, Inject } from '@forinda/kickjs-core'
import { TASK_REPOSITORY, type ITaskRepository } from '../../domain/repositories/task.repository'
import type { TaskResponseDTO } from '../dtos/task-response.dto'

@Service()
export class GetTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly repo: ITaskRepository,
  ) {}

  async execute(id: string): Promise<TaskResponseDTO | null> {
    return this.repo.findById(id)
  }
}
