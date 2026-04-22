import { Service, Inject, HttpException, Logger } from '@forinda/kickjs';
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { IUserRepository } from '@/modules/users/domain/repositories/user.repository';
import type { IWorkspaceMemberRepository } from '../../domain/repositories/workspace-member.repository';
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository';
import type { InviteMemberDto } from '../dtos/invite-member.dto';

const logger = Logger.for('InviteMemberUseCase');

@Service()
export class InviteMemberUseCase {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
    @Inject(TOKENS.WORKSPACE_REPOSITORY) private workspaceRepo: IWorkspaceRepository,
    @Inject(TOKENS.WORKSPACE_MEMBER_REPOSITORY) private memberRepo: IWorkspaceMemberRepository,
    @Inject(QUEUE_MANAGER) private queueService: QueueService,
  ) {}

  async execute(workspaceId: string, dto: InviteMemberDto) {
    const user = await this.userRepo.findByEmail(dto.email);
    if (!user) {
      throw HttpException.notFound(ErrorCode.USER_NOT_FOUND);
    }

    const existing = await this.memberRepo.findByUserAndWorkspace(user._id.toString(), workspaceId);
    if (existing) {
      throw HttpException.conflict(ErrorCode.ALREADY_WORKSPACE_MEMBER);
    }

    const workspace = await this.workspaceRepo.findById(workspaceId);

    const member = await this.memberRepo.create({
      workspaceId: workspaceId as any,
      userId: user._id,
      role: dto.role,
      joinedAt: new Date(),
    });

    // Queue invite email
    try {
      await this.queueService.add('email', 'send-workspace-invite', {
        email: user.email,
        workspaceName: workspace?.name ?? 'Workspace',
        inviterName: dto.email,
      });
    } catch (err) {
      logger.warn('Failed to queue workspace invite email');
    }

    return member;
  }
}
