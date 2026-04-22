import Redis from 'ioredis';
import { Logger } from '@forinda/kickjs';
import type { AppAdapter, Container } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';

const logger = Logger.for('RedisAdapter');

export class RedisAdapter implements AppAdapter {
  name = 'RedisAdapter';
  private client!: Redis;

  constructor(private readonly url: string) {}

  async beforeStart(_app: any, container: Container) {
    logger.info('Connecting to Redis...');
    this.client = new Redis(this.url);
    this.client.on('error', (err) => logger.error(err, 'Redis error'));
    this.client.on('connect', () => logger.info('Redis connected'));
    container.registerInstance(TOKENS.REDIS, this.client);
  }

  async shutdown() {
    logger.info('Disconnecting from Redis...');
    await this.client.quit();
    logger.info('Redis disconnected');
  }
}

export function createRedisConnection(url: string): Redis {
  return new Redis(url);
}
