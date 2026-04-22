import { Service, Inject } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import type { IProjectRepository } from '../../domain/repositories/project.repository';

@Service()
export class ListProjectsUseCase {
  constructor(
    @Inject(TOKENS.PROJECT_REPOSITORY) private projectRepo: IProjectRepository,
  ) {}

  async execute(workspaceId: string) {
    return this.projectRepo.findByWorkspace(workspaceId);
  }
}
