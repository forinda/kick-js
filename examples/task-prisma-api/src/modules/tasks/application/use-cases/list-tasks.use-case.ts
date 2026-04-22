import { Service, Inject } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import type { ParsedQuery } from '@forinda/kickjs'
import type { ITaskRepository } from '../../domain/repositories/task.repository'

@Service()
export class ListTasksUseCase {
  constructor(
    @Inject(TOKENS.TASK_REPOSITORY)
    private readonly repo: ITaskRepository,
  ) {}

  async execute(parsed: ParsedQuery, projectId?: string) {
    return this.repo.findPaginated(parsed, projectId)
  }
}
