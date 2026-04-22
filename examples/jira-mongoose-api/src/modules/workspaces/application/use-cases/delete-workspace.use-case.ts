import { Service, Inject, HttpException } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository';

@Service()
export class DeleteWorkspaceUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_REPOSITORY) private workspaceRepo: IWorkspaceRepository,
  ) {}

  async execute(workspaceId: string) {
    const deleted = await this.workspaceRepo.delete(workspaceId);
    if (!deleted) {
      throw HttpException.notFound(ErrorCode.WORKSPACE_NOT_FOUND);
    }
  }
}
