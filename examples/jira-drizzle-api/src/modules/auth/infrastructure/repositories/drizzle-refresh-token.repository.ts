import { Repository, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import { eq, lt } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { refreshTokens } from '@/db/schema'
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token.repository'

@Repository()
export class DrizzleRefreshTokenRepository implements IRefreshTokenRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async create(data: { userId: string; token: string; expiresAt: Date }) {
    const [result] = await this.db.insert(refreshTokens).values(data).returning()
    return result
  }

  async findByToken(token: string) {
    const [result] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.token, token))
    return result ?? null
  }

  async deleteByToken(token: string): Promise<boolean> {
    const result = await this.db
      .delete(refreshTokens)
      .where(eq(refreshTokens.token, token))
      .returning()
    return result.length > 0
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db.delete(refreshTokens).where(eq(refreshTokens.userId, userId))
  }

  async deleteExpired(): Promise<number> {
    const result = await this.db
      .delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, new Date()))
      .returning()
    return result.length
  }
}
