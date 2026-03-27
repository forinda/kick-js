import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IChannelMemberRepository } from '../../domain/repositories/channel.repository'

@Service()
export class ManageChannelMembersUseCase {
  constructor(
    @Inject(TOKENS.CHANNEL_MEMBER_REPOSITORY)
    private readonly memberRepo: IChannelMemberRepository,
  ) {}

  async listMembers(channelId: string) {
    return this.memberRepo.listMembers(channelId)
  }

  async addMember(channelId: string, userId: string) {
    const existing = await this.memberRepo.findByChannelAndUser(channelId, userId)
    if (existing) throw HttpException.conflict('User is already a member')
    return this.memberRepo.addMember(channelId, userId)
  }

  async removeMember(channelId: string, userId: string) {
    await this.memberRepo.removeMember(channelId, userId)
  }
}
