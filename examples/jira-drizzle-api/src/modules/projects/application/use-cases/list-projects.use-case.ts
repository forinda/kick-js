import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IProjectRepository } from '../../domain/repositories/project.repository'

@Service()
export class ListProjectsUseCase {
  constructor(
    @Inject(TOKENS.PROJECT_REPOSITORY)
    private readonly repo: IProjectRepository,
  ) {}

  async executeByWorkspace(workspaceId: string) {
    return this.repo.findByWorkspace(workspaceId)
  }
}
