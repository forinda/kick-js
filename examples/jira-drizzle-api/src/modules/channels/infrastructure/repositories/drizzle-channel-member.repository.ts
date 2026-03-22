import { eq, and } from 'drizzle-orm'
import { Repository, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { IChannelMemberRepository } from '../../domain/repositories/channel.repository'
import { channelMembers } from '@/db/schema'

@Repository()
export class DrizzleChannelMemberRepository implements IChannelMemberRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findByChannelAndUser(channelId: string, userId: string) {
    const [member] = await this.db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    return member ?? null
  }

  async listMembers(channelId: string) {
    return this.db.select().from(channelMembers).where(eq(channelMembers.channelId, channelId))
  }

  async addMember(channelId: string, userId: string) {
    const [member] = await this.db.insert(channelMembers).values({ channelId, userId }).returning()
    return member
  }

  async removeMember(channelId: string, userId: string) {
    await this.db
      .delete(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
  }
}
