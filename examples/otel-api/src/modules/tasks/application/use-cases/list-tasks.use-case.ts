import { Service, Inject } from '@forinda/kickjs-core'
import { TASK_REPOSITORY, type ITaskRepository } from '../../domain/repositories/task.repository'
import type { ParsedQuery } from '@forinda/kickjs-http'

@Service()
export class ListTasksUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly repo: ITaskRepository,
  ) {}

  async execute(parsed: ParsedQuery) {
    return this.repo.findPaginated(parsed)
  }
}
