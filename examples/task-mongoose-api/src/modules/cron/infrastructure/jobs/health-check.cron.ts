import { Service, Autowired, Logger } from '@forinda/kickjs';
import { Cron } from '../../cron.decorator';
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue';
import { TOKENS } from '@/shared/constants/tokens';
import mongoose from 'mongoose';
import type { Redis } from 'ioredis';

const logger = Logger.for('HealthCheckCron');

@Service()
export class HealthCheckCronJobs {
  @Autowired(TOKENS.REDIS) private redis!: Redis;
  @Autowired(QUEUE_MANAGER) private queueService!: QueueService;

  @Cron('* * * * *', { description: 'Run system health check every minute' })
  async healthCheck() {
    const results = {
      mongo: false,
      redis: false,
      queues: false,
    };

    try {
      results.mongo = mongoose.connection.readyState === 1;
    } catch { /* ignore */ }

    try {
      const pong = await this.redis.ping();
      results.redis = pong === 'PONG';
    } catch { /* ignore */ }

    try {
      const queueNames = this.queueService.getQueueNames();
      results.queues = queueNames.length > 0;
    } catch { /* ignore */ }

    const allHealthy = results.mongo && results.redis && results.queues;

    if (allHealthy) {
      logger.info('Health OK — mongo: ✓, redis: ✓, queues: ✓');
    } else {
      logger.warn(
        `Health DEGRADED — mongo: ${results.mongo ? '✓' : '✗'}, redis: ${results.redis ? '✓' : '✗'}, queues: ${results.queues ? '✓' : '✗'}`,
      );
    }
  }
}
