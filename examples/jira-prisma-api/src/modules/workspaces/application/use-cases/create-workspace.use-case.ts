import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import { ErrorCode } from '@/shared/constants/error-codes'
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository'
import type { IWorkspaceMemberRepository } from '../../domain/repositories/workspace-member.repository'
import type { CreateWorkspaceDTO } from '../dtos/create-workspace.dto'

@Service()
export class CreateWorkspaceUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_REPOSITORY)
    private readonly repo: IWorkspaceRepository,
    @Inject(TOKENS.WORKSPACE_MEMBER_REPOSITORY)
    private readonly memberRepo: IWorkspaceMemberRepository,
  ) {}

  async execute(dto: CreateWorkspaceDTO, ownerId: string) {
    const existing = await this.repo.findBySlug(dto.slug)
    if (existing) {
      throw HttpException.conflict(ErrorCode.WORKSPACE_SLUG_EXISTS)
    }

    const workspace = await this.repo.create({ ...dto, ownerId })

    // Add owner as admin member
    await this.memberRepo.add({
      workspaceId: workspace.id,
      userId: ownerId,
      role: 'admin',
    })

    return workspace
  }
}
