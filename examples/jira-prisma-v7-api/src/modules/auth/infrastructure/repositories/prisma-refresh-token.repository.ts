import { Repository, Inject } from '@forinda/kickjs'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@/generated/prisma/client'
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token.repository'

@Repository()
export class PrismaRefreshTokenRepository implements IRefreshTokenRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async create(data: { userId: string; token: string; expiresAt: Date }) {
    return this.prisma.refreshToken.create({ data })
  }

  async findByToken(token: string) {
    return this.prisma.refreshToken.findUnique({ where: { token } })
  }

  async deleteByToken(token: string): Promise<boolean> {
    try {
      await this.prisma.refreshToken.delete({ where: { token } })
      return true
    } catch {
      return false
    }
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { userId } })
  }

  async deleteExpired(): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
    return result.count
  }
}
