import { Service, Inject, HttpException } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { ITaskRepository } from '../../domain/repositories/task.repository';
import type { ReorderTaskDto } from '../dtos/reorder-task.dto';

@Service()
export class ReorderTaskUseCase {
  constructor(
    @Inject(TOKENS.TASK_REPOSITORY) private taskRepo: ITaskRepository,
  ) {}

  async execute(taskId: string, dto: ReorderTaskDto) {
    const task = await this.taskRepo.update(taskId, {
      status: dto.status,
      orderIndex: dto.orderIndex,
    });
    if (!task) throw HttpException.notFound(ErrorCode.TASK_NOT_FOUND);
    return task;
  }
}
