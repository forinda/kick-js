import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository'
import type { UpdateWorkspaceDTO } from '../dtos/update-workspace.dto'

@Service()
export class UpdateWorkspaceUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_REPOSITORY)
    private readonly repo: IWorkspaceRepository,
  ) {}

  async execute(id: string, dto: UpdateWorkspaceDTO) {
    return this.repo.update(id, dto)
  }
}
