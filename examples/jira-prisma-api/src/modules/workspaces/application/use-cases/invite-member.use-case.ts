import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import { ErrorCode } from '@/shared/constants/error-codes'
import type { IWorkspaceMemberRepository } from '../../domain/repositories/workspace-member.repository'
import type { InviteMemberDTO } from '../dtos/invite-member.dto'

@Service()
export class InviteMemberUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_MEMBER_REPOSITORY)
    private readonly memberRepo: IWorkspaceMemberRepository,
  ) {}

  async execute(workspaceId: string, dto: InviteMemberDTO) {
    const existing = await this.memberRepo.findByWorkspaceAndUser(workspaceId, dto.userId)
    if (existing) {
      throw HttpException.conflict(ErrorCode.ALREADY_WORKSPACE_MEMBER)
    }

    return this.memberRepo.add({
      workspaceId,
      userId: dto.userId,
      role: dto.role,
    })
  }
}
