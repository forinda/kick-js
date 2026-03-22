import { Service, Inject, Logger } from '@forinda/kickjs-core'
import { Cron } from '@forinda/kickjs-cron'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { lt, sql } from 'drizzle-orm'
import { refreshTokens } from '@/db/schema'

const logger = Logger.for('CleanupCronJobs')

@Service()
export class CleanupCronJobs {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  @Cron('0 3 * * *', { description: 'Clean up expired refresh tokens', timezone: 'UTC' })
  async cleanupTokens() {
    logger.info('Running token cleanup...')
    const result = await this.db
      .delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, new Date()))
    logger.info('Cleaned up expired refresh tokens')
  }
}
