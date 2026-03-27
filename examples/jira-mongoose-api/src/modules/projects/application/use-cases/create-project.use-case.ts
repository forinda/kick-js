import { Service, Inject, HttpException } from '@forinda/kickjs-core';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { IProjectRepository } from '../../domain/repositories/project.repository';
import type { CreateProjectDto } from '../dtos/create-project.dto';

@Service()
export class CreateProjectUseCase {
  constructor(
    @Inject(TOKENS.PROJECT_REPOSITORY) private projectRepo: IProjectRepository,
  ) {}

  async execute(workspaceId: string, dto: CreateProjectDto) {
    const existing = await this.projectRepo.findByKeyAndWorkspace(dto.key, workspaceId);
    if (existing) {
      throw HttpException.conflict(ErrorCode.PROJECT_KEY_EXISTS);
    }

    return this.projectRepo.create({
      ...dto,
      workspaceId: workspaceId as any,
      leadId: dto.leadId as any,
    });
  }
}
