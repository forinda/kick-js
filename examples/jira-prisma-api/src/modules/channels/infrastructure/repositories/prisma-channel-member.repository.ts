import { Repository, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import type { IChannelMemberRepository } from '../../domain/repositories/channel.repository'

@Repository()
export class PrismaChannelMemberRepository implements IChannelMemberRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findByChannelAndUser(channelId: string, userId: string) {
    return this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    })
  }

  async listMembers(channelId: string) {
    return this.prisma.channelMember.findMany({ where: { channelId } })
  }

  async addMember(channelId: string, userId: string) {
    return this.prisma.channelMember.create({ data: { channelId, userId } })
  }

  async removeMember(channelId: string, userId: string) {
    await this.prisma.channelMember.delete({
      where: { channelId_userId: { channelId, userId } },
    })
  }
}
