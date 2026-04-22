import { Service, Inject } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import type { ITaskRepository } from '../../domain/repositories/task.repository'

@Service()
export class DeleteTaskUseCase {
  constructor(
    @Inject(TOKENS.TASK_REPOSITORY)
    private readonly repo: ITaskRepository,
  ) {}

  async execute(id: string) {
    await this.repo.delete(id)
  }
}
