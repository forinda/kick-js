import { Service, Logger } from '@forinda/kickjs'
import { Cron } from '../../cron.decorator'

const logger = Logger.for('DigestCronJobs')

@Service()
export class DigestCronJobs {
  @Cron('0 8 * * 1-5', { description: 'Send daily digest emails', timezone: 'UTC' })
  async dailyDigest() {
    logger.info('Running daily digest... (placeholder)')
    // TODO: Aggregate yesterday's activity per workspace, enqueue digest emails
  }
}
