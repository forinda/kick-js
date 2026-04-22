import { Service, Inject, HttpException } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { ITaskRepository } from '../../domain/repositories/task.repository';

@Service()
export class ChangeStatusUseCase {
  constructor(
    @Inject(TOKENS.TASK_REPOSITORY) private taskRepo: ITaskRepository,
  ) {}

  async execute(taskId: string, status: string) {
    const task = await this.taskRepo.update(taskId, { status });
    if (!task) throw HttpException.notFound(ErrorCode.TASK_NOT_FOUND);
    return task;
  }
}
