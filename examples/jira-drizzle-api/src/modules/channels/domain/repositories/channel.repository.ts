import type { channels, channelMembers } from '@/db/schema'
import type { ParsedQuery } from '@forinda/kickjs'

export type Channel = typeof channels.$inferSelect
export type NewChannel = typeof channels.$inferInsert
export type ChannelMember = typeof channelMembers.$inferSelect

export interface IChannelRepository {
  findById(id: string): Promise<Channel | null>
  findPaginated(
    parsed: ParsedQuery,
    workspaceId: string,
  ): Promise<{ data: Channel[]; total: number }>
  create(data: NewChannel): Promise<Channel>
  update(id: string, data: Partial<NewChannel>): Promise<Channel>
  delete(id: string): Promise<void>
}

export interface IChannelMemberRepository {
  findByChannelAndUser(channelId: string, userId: string): Promise<ChannelMember | null>
  listMembers(channelId: string): Promise<ChannelMember[]>
  addMember(channelId: string, userId: string): Promise<ChannelMember>
  removeMember(channelId: string, userId: string): Promise<void>
}

export const CHANNEL_REPOSITORY = Symbol('IChannelRepository')
export const CHANNEL_MEMBER_REPOSITORY = Symbol('IChannelMemberRepository')
