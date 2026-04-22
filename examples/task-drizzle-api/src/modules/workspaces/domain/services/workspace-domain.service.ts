import { Service, Inject, HttpException } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import { ErrorCode } from '@/shared/constants/error-codes'
import type { IWorkspaceRepository, Workspace } from '../repositories/workspace.repository'
import type {
  IWorkspaceMemberRepository,
  WorkspaceMember,
} from '../repositories/workspace-member.repository'

@Service()
export class WorkspaceDomainService {
  constructor(
    @Inject(TOKENS.WORKSPACE_REPOSITORY)
    private readonly repo: IWorkspaceRepository,
    @Inject(TOKENS.WORKSPACE_MEMBER_REPOSITORY)
    private readonly memberRepo: IWorkspaceMemberRepository,
  ) {}

  async ensureExists(id: string): Promise<Workspace> {
    const workspace = await this.repo.findById(id)
    if (!workspace) {
      throw HttpException.notFound(ErrorCode.WORKSPACE_NOT_FOUND)
    }
    return workspace
  }

  async ensureMembership(workspaceId: string, userId: string): Promise<WorkspaceMember> {
    const member = await this.memberRepo.findByWorkspaceAndUser(workspaceId, userId)
    if (!member) {
      throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER)
    }
    return member
  }

  async ensureAdmin(workspaceId: string, userId: string): Promise<WorkspaceMember> {
    const member = await this.ensureMembership(workspaceId, userId)
    if (member.role !== 'admin') {
      throw HttpException.forbidden(ErrorCode.FORBIDDEN)
    }
    return member
  }
}
