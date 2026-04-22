import { Service, Inject, HttpException } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { IProjectRepository } from '../../domain/repositories/project.repository';
import type { UpdateProjectDto } from '../dtos/update-project.dto';

@Service()
export class UpdateProjectUseCase {
  constructor(
    @Inject(TOKENS.PROJECT_REPOSITORY) private projectRepo: IProjectRepository,
  ) {}

  async execute(projectId: string, dto: UpdateProjectDto) {
    const project = await this.projectRepo.update(projectId, dto as any);
    if (!project) {
      throw HttpException.notFound(ErrorCode.PROJECT_NOT_FOUND);
    }
    return project;
  }
}
