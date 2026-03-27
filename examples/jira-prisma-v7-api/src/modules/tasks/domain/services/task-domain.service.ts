import { Service, Inject, HttpException } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import { ErrorCode } from '@/shared/constants/error-codes'
import type { ITaskRepository, Task } from '../repositories/task.repository'

@Service()
export class TaskDomainService {
  constructor(
    @Inject(TOKENS.TASK_REPOSITORY)
    private readonly repo: ITaskRepository,
  ) {}

  async ensureExists(id: string): Promise<Task> {
    const task = await this.repo.findById(id)
    if (!task) {
      throw HttpException.notFound(ErrorCode.TASK_NOT_FOUND)
    }
    return task
  }
}
