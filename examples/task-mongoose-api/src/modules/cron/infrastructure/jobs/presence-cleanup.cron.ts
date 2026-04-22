import { Service } from '@forinda/kickjs';
import { Cron } from '@forinda/kickjs-cron';
import { Logger } from '@forinda/kickjs';

const logger = Logger.for('PresenceCronJobs');

@Service()
export class PresenceCronJobs {
  @Cron('*/5 * * * *', { description: 'Clean up stale presence entries' })
  async cleanupPresence() {
    logger.info('Running presence cleanup... (placeholder)');
    // TODO: Check Redis presence hash, remove entries with stale heartbeats
  }
}
