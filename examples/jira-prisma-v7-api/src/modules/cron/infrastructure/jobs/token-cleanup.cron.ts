import { Service, Inject, Logger } from '@forinda/kickjs-core'
import { Cron } from '@forinda/kickjs-cron'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@/generated/prisma/client'

const logger = Logger.for('CleanupCronJobs')

@Service()
export class CleanupCronJobs {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  @Cron('0 3 * * *', { description: 'Clean up expired refresh tokens', timezone: 'UTC' })
  async cleanupTokens() {
    logger.info('Running token cleanup...')
    await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
    logger.info('Cleaned up expired refresh tokens')
  }
}
