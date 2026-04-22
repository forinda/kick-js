import { Service, Inject } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import type { IWorkspaceMemberRepository } from '../../domain/repositories/workspace-member.repository';
import type { IUserRepository } from '@/modules/users/domain/repositories/user.repository';

@Service()
export class ListMembersUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_MEMBER_REPOSITORY) private memberRepo: IWorkspaceMemberRepository,
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
  ) {}

  async execute(workspaceId: string) {
    const members = await this.memberRepo.findByWorkspace(workspaceId);
    const enriched = await Promise.all(
      members.map(async (m) => {
        const user = await this.userRepo.findById(m.userId.toString());
        return {
          id: m._id.toString(),
          userId: m.userId.toString(),
          role: m.role,
          joinedAt: m.joinedAt,
          user: user
            ? {
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                avatarUrl: user.avatarUrl,
              }
            : null,
        };
      }),
    );
    return enriched;
  }
}
