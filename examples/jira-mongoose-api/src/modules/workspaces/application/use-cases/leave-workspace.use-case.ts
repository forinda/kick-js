import { Service, Inject, HttpException } from '@forinda/kickjs-core';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { IWorkspaceMemberRepository } from '../../domain/repositories/workspace-member.repository';
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository';

@Service()
export class LeaveWorkspaceUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_MEMBER_REPOSITORY) private memberRepo: IWorkspaceMemberRepository,
    @Inject(TOKENS.WORKSPACE_REPOSITORY) private workspaceRepo: IWorkspaceRepository,
  ) {}

  async execute(workspaceId: string, userId: string) {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) {
      throw HttpException.notFound(ErrorCode.WORKSPACE_NOT_FOUND);
    }

    if (workspace.ownerId.toString() === userId) {
      throw HttpException.forbidden(ErrorCode.CANNOT_REMOVE_OWNER);
    }

    await this.memberRepo.deleteByUserAndWorkspace(userId, workspaceId);
  }
}
