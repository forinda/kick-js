import { Service, Inject, HttpException } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { IProjectRepository } from '../../domain/repositories/project.repository';
import type { ITaskRepository } from '@/modules/tasks/domain/repositories/task.repository';

@Service()
export class GetBoardViewUseCase {
  constructor(
    @Inject(TOKENS.PROJECT_REPOSITORY) private projectRepo: IProjectRepository,
    @Inject(TOKENS.TASK_REPOSITORY) private taskRepo: ITaskRepository,
  ) {}

  async execute(projectId: string) {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw HttpException.notFound(ErrorCode.PROJECT_NOT_FOUND);
    }

    const tasks = await this.taskRepo.findByProject(projectId);

    const columns = project.statusColumns
      .sort((a, b) => a.order - b.order)
      .map((col) => ({
        ...col,
        tasks: tasks
          .filter((t) => t.status === col.name)
          .sort((a, b) => a.orderIndex - b.orderIndex),
      }));

    return { project, columns };
  }
}
