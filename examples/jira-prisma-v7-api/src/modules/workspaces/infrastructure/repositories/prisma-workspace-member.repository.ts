import { Repository, Inject } from '@forinda/kickjs'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient, User, WorkspaceMember } from '@/generated/prisma/client'
import type {
  IWorkspaceMemberRepository,
  NewWorkspaceMember,
} from '../../domain/repositories/workspace-member.repository'

@Repository()
export class PrismaWorkspaceMemberRepository implements IWorkspaceMemberRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findByWorkspaceAndUser(workspaceId: string, userId: string) {
    return this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
  }

  async listByWorkspace(workspaceId: string) {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    })
    return members.map(({ user, ...member }) => ({
      member: member as WorkspaceMember,
      user: user as User,
    }))
  }

  async listByUser(userId: string) {
    return this.prisma.workspaceMember.findMany({ where: { userId } })
  }

  async add(data: NewWorkspaceMember) {
    return this.prisma.workspaceMember.create({ data })
  }

  async updateRole(workspaceId: string, userId: string, role: string) {
    return this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { role: role as any },
    })
  }

  async remove(workspaceId: string, userId: string) {
    await this.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
  }
}
