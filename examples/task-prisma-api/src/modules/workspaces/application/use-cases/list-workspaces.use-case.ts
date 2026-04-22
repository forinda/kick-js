import { Service, Inject } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository'

@Service()
export class ListWorkspacesUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_REPOSITORY)
    private readonly repo: IWorkspaceRepository,
  ) {}

  async executeForUser(userId: string) {
    return this.repo.findForUser(userId)
  }
}
