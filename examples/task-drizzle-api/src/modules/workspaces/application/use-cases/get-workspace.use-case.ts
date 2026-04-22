import { Service, Inject } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository'

@Service()
export class GetWorkspaceUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_REPOSITORY)
    private readonly repo: IWorkspaceRepository,
  ) {}

  async execute(id: string) {
    return this.repo.findById(id)
  }
}
