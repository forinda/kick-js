import { Service, Inject } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository'

@Service()
export class DeleteWorkspaceUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_REPOSITORY)
    private readonly repo: IWorkspaceRepository,
  ) {}

  async execute(id: string) {
    await this.repo.delete(id)
  }
}
