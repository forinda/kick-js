import { Service, Inject } from '@forinda/kickjs-core';
import { TOKENS } from '@/shared/constants/tokens';
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository';
import type { IWorkspaceMemberRepository } from '../../domain/repositories/workspace-member.repository';

@Service()
export class ListWorkspacesUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_REPOSITORY) private workspaceRepo: IWorkspaceRepository,
    @Inject(TOKENS.WORKSPACE_MEMBER_REPOSITORY) private memberRepo: IWorkspaceMemberRepository,
  ) {}

  async execute(userId: string) {
    const memberships = await this.memberRepo.findByUser(userId);
    const workspaces = await Promise.all(
      memberships.map(async (m) => {
        const ws = await this.workspaceRepo.findById(m.workspaceId.toString());
        return ws ? { ...ws, role: m.role } : null;
      }),
    );
    return workspaces.filter(Boolean);
  }
}
