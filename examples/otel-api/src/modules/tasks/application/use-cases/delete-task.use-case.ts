import { Service, Inject } from '@forinda/kickjs-core'
import { TASK_REPOSITORY, type ITaskRepository } from '../../domain/repositories/task.repository'

@Service()
export class DeleteTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly repo: ITaskRepository,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
