import { Service, Inject, HttpException } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository';
import type { IWorkspaceMemberRepository } from '../../domain/repositories/workspace-member.repository';
import type { CreateWorkspaceDto } from '../dtos/create-workspace.dto';

@Service()
export class CreateWorkspaceUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_REPOSITORY) private workspaceRepo: IWorkspaceRepository,
    @Inject(TOKENS.WORKSPACE_MEMBER_REPOSITORY) private memberRepo: IWorkspaceMemberRepository,
  ) {}

  async execute(userId: string, dto: CreateWorkspaceDto) {
    const existing = await this.workspaceRepo.findBySlug(dto.slug);
    if (existing) {
      throw HttpException.conflict(ErrorCode.WORKSPACE_SLUG_EXISTS);
    }

    const workspace = await this.workspaceRepo.create({
      ...dto,
      ownerId: userId as any,
    });

    // Owner becomes admin
    await this.memberRepo.create({
      workspaceId: workspace._id,
      userId: userId as any,
      role: 'admin',
      joinedAt: new Date(),
    });

    return workspace;
  }
}
