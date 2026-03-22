import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IWorkspaceMemberRepository } from '../../domain/repositories/workspace-member.repository'

@Service()
export class ListMembersUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_MEMBER_REPOSITORY)
    private readonly memberRepo: IWorkspaceMemberRepository,
  ) {}

  async execute(workspaceId: string) {
    return this.memberRepo.listByWorkspace(workspaceId)
  }
}
