import { Service, Inject, Logger } from '@forinda/kickjs'
import { Cron } from '../../cron.decorator'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'

const logger = Logger.for('HealthCheckCron')

@Service()
export class HealthCheckCronJobs {
  constructor(
    @Inject(DRIZZLE_DB) private db: PostgresJsDatabase,
    @Inject(QUEUE_MANAGER) private queueService: QueueService,
  ) {}

  @Cron('* * * * *', { description: 'Run system health check every minute' })
  async healthCheck() {
    const results = { postgres: false, queues: false }

    try {
      await this.db.execute(sql`SELECT 1`)
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
