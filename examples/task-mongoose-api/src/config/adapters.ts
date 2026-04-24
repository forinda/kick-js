import { DevToolsAdapter } from '@forinda/kickjs-devtools';
import { SwaggerAdapter } from '@forinda/kickjs-swagger';
import { AuthAdapter, JwtStrategy } from '@forinda/kickjs-auth';
import { WsAdapter } from '@forinda/kickjs-ws';
import { QueueAdapter } from '@forinda/kickjs-queue';
import { CronAdapter } from '@/modules/cron/cron.adapter';
import { env } from './env';
import { MongooseAdapter } from '@/shared/infrastructure/database/mongoose.adapter';
import { RedisAdapter } from '@/shared/infrastructure/redis/redis.config';
import { TaskCronJobs } from '@/modules/cron/infrastructure/jobs/overdue-reminders.cron';
import { DigestCronJobs } from '@/modules/cron/infrastructure/jobs/daily-digest.cron';
import { CleanupCronJobs } from '@/modules/cron/infrastructure/jobs/token-cleanup.cron';
import { PresenceCronJobs } from '@/modules/cron/infrastructure/jobs/presence-cleanup.cron';
import { HealthCheckCronJobs } from '@/modules/cron/infrastructure/jobs/health-check.cron';

const redisUrl = new URL(env.REDIS_URL);

const wsAdapter = WsAdapter({
  path: '/ws',
  heartbeatInterval: 30000,
  maxPayload: 1048576,
});

const queueAdapter = QueueAdapter({
  redis: {
    host: redisUrl.hostname,
    port: Number(redisUrl.port) || 6379,
    password: redisUrl.password || undefined,
  },
  queues: ['email', 'notifications', 'activity'],
  concurrency: 5,
});

export const adapters = [
  new MongooseAdapter(env.MONGODB_URI),
  new RedisAdapter(env.REDIS_URL),
  AuthAdapter({
    strategies: [
      JwtStrategy({
        secret: env.JWT_SECRET,
        mapPayload: (payload: any) => ({
          id: payload.sub,
          email: payload.email,
          globalRole: payload.globalRole ?? 'user',
        }),
      }),
    ],
    defaultPolicy: 'protected',
  }),
  wsAdapter,
  queueAdapter,
  CronAdapter({
    services: [TaskCronJobs, DigestCronJobs, CleanupCronJobs, PresenceCronJobs, HealthCheckCronJobs],
    enabled: true,
  }),
  DevToolsAdapter({
    secret: env.NODE_ENV === 'production' ? undefined : false,
    adapters: [wsAdapter, queueAdapter],
  }),
  SwaggerAdapter({
    info: { title: 'Vibed API', version: '1.0.0', description: 'Task management API' },
  }),
];
