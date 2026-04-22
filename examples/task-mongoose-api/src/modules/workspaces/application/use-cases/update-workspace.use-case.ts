import { Service, Inject, HttpException } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository';
import type { UpdateWorkspaceDto } from '../dtos/update-workspace.dto';

@Service()
export class UpdateWorkspaceUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_REPOSITORY) private workspaceRepo: IWorkspaceRepository,
  ) {}

  async execute(workspaceId: string, dto: UpdateWorkspaceDto) {
    const workspace = await this.workspaceRepo.update(workspaceId, dto);
    if (!workspace) {
      throw HttpException.notFound(ErrorCode.WORKSPACE_NOT_FOUND);
    }
    return workspace;
  }
}
