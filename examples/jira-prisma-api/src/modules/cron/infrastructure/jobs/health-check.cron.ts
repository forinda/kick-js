import { Service, Inject, Logger } from '@forinda/kickjs'
import { Cron } from '@forinda/kickjs-cron'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue'
import type { PrismaClient } from '@prisma/client'

const logger = Logger.for('HealthCheckCron')

@Service()
export class HealthCheckCronJobs {
  constructor(
    @Inject(PRISMA_CLIENT) private prisma: PrismaClient,
    @Inject(QUEUE_MANAGER) private queueService: QueueService,
  ) {}

  @Cron('* * * * *', { description: 'Run system health check every minute' })
  async healthCheck() {
    const results = { postgres: false, queues: false }

    try {
      await this.prisma.$queryRaw`SELECT 1`
      results.postgres = true
    } catch {
      /* ignore */
    }

    try {
      const queueNames = this.queueService.getQueueNames()
      results.queues = queueNames.length > 0
    } catch {
      /* ignore */
    }

    const allHealthy = results.postgres && results.queues
    if (allHealthy) {
      logger.info('Health OK — postgres: ✓, queues: ✓')
    } else {
      logger.warn(
        `Health DEGRADED — postgres: ${results.postgres ? '✓' : '✗'}, queues: ${results.queues ? '✓' : '✗'}`,
      )
    }
  }
}
