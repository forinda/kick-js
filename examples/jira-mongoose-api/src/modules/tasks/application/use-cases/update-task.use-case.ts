import { Service, Inject, HttpException } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { ITaskRepository } from '../../domain/repositories/task.repository';
import type { UpdateTaskDto } from '../dtos/update-task.dto';

@Service()
export class UpdateTaskUseCase {
  constructor(
    @Inject(TOKENS.TASK_REPOSITORY) private taskRepo: ITaskRepository,
  ) {}

  async execute(taskId: string, dto: UpdateTaskDto) {
    const updateData: any = { ...dto };
    if (dto.dueDate) updateData.dueDate = new Date(dto.dueDate);
    if (dto.dueDate === null) updateData.dueDate = null;

    const task = await this.taskRepo.update(taskId, updateData);
    if (!task) throw HttpException.notFound(ErrorCode.TASK_NOT_FOUND);
    return task;
  }
}
