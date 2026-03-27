import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { ITaskRepository } from '../../domain/repositories/task.repository'

@Service()
export class ListSubtasksUseCase {
  constructor(
    @Inject(TOKENS.TASK_REPOSITORY)
    private readonly repo: ITaskRepository,
  ) {}

  async execute(parentTaskId: string) {
    return this.repo.findSubtasks(parentTaskId)
  }
}
