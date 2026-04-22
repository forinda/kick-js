import { DevToolsAdapter } from '@forinda/kickjs-devtools';
import { SwaggerAdapter } from '@forinda/kickjs-swagger';
import { AuthAdapter, JwtStrategy } from '@forinda/kickjs-auth';
import { WsAdapter } from '@forinda/kickjs-ws';
import { MailerAdapter } from '@forinda/kickjs-mailer';
import { QueueAdapter } from '@forinda/kickjs-queue';
import { CronAdapter } from '@forinda/kickjs-cron';
import { env } from './env';
import { MongooseAdapter } from '@/shared/infrastructure/database/mongoose.adapter';
import { RedisAdapter } from '@/shared/infrastructure/redis/redis.config';
import { ConsoleProvider } from '@forinda/kickjs-mailer';
import { ResendMailProvider } from '@/shared/infrastructure/mail/resend.provider';
import { TaskCronJobs } from '@/modules/cron/infrastructure/jobs/overdue-reminders.cron';
import { DigestCronJobs } from '@/modules/cron/infrastructure/jobs/daily-digest.cron';
import { CleanupCronJobs } from '@/modules/cron/infrastructure/jobs/token-cleanup.cron';
import { PresenceCronJobs } from '@/modules/cron/infrastructure/jobs/presence-cleanup.cron';
import { HealthCheckCronJobs } from '@/modules/cron/infrastructure/jobs/health-check.cron';

const redisUrl = new URL(env.REDIS_URL);

const wsAdapter = new WsAdapter({
  path: '/ws',
  heartbeatInterval: 30000,
  maxPayload: 1048576,
});

const queueAdapter = new QueueAdapter({
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
  MailerAdapter({
    provider: env.NODE_ENV === 'production'
      ? new ResendMailProvider(env.RESEND_API_KEY)
      : new ConsoleProvider(),
    defaultFrom: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_EMAIL },
  }),
  queueAdapter,
  CronAdapter({
    services: [TaskCronJobs, DigestCronJobs, CleanupCronJobs, PresenceCronJobs, HealthCheckCronJobs],
    enabled: true,
  }),
  new DevToolsAdapter({
    secret: env.NODE_ENV === 'production' ? undefined : false,
    adapters: [wsAdapter, queueAdapter],
  }),
  SwaggerAdapter({
    info: { title: 'Vibed API', version: '1.0.0', description: 'Task management API like Jira' },
  }),
];
