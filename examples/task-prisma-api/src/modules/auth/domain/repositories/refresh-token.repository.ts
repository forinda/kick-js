import type { RefreshToken } from '@/generated/prisma/client'

export type { RefreshToken }

export interface IRefreshTokenRepository {
  create(data: { userId: string; token: string; expiresAt: Date }): Promise<RefreshToken>
  findByToken(token: string): Promise<RefreshToken | null>
  deleteByToken(token: string): Promise<boolean>
  deleteByUserId(userId: string): Promise<void>
  deleteExpired(): Promise<number>
}
