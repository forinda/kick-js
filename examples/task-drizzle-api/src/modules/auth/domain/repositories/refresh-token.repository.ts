import type { refreshTokens } from '@/db/schema'

export type RefreshToken = typeof refreshTokens.$inferSelect
export type NewRefreshToken = typeof refreshTokens.$inferInsert

export interface IRefreshTokenRepository {
  create(data: NewRefreshToken): Promise<RefreshToken>
  findByToken(token: string): Promise<RefreshToken | null>
  deleteByToken(token: string): Promise<boolean>
  deleteByUserId(userId: string): Promise<void>
  deleteExpired(): Promise<number>
}
