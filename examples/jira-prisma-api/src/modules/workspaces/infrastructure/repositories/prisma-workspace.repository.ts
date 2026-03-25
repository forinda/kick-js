import { Repository, Inject, HttpException } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository'
import { WORKSPACE_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class PrismaWorkspaceRepository implements IWorkspaceRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.workspace.findUnique({ where: { id } })
  }

  async findBySlug(slug: string) {
    return this.prisma.workspace.findUnique({ where: { slug } })
  }

  async findForUser(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
    })
    return memberships.map((m) => m.workspace)
  }

  async findPaginated(parsed: ParsedQuery) {
    const query = queryAdapter.build(parsed, WORKSPACE_QUERY_CONFIG)

    const [data, total] = await Promise.all([
      this.prisma.workspace.findMany({
        where: query.where,
        orderBy: query.orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.workspace.count({ where: query.where }),
    ])

    return { data, total }
  }

  async create(dto: any) {
    return this.prisma.workspace.create({ data: dto })
  }

  async update(id: string, dto: any) {
    const workspace = await this.prisma.workspace
      .update({ where: { id }, data: dto })
      .catch(() => null)
    if (!workspace) throw HttpException.notFound('Workspace not found')
    return workspace
  }

  async delete(id: string) {
    await this.prisma.workspace.delete({ where: { id } })
  }
}
