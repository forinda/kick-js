import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { PrismaAdapter } from '@forinda/kickjs-prisma'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { WsAdapter } from '@forinda/kickjs-ws'
import { MailerAdapter, ConsoleProvider } from '@forinda/kickjs-mailer'
import { QueueAdapter } from '@forinda/kickjs-queue'
import { CronAdapter } from '@forinda/kickjs-cron'
import { AppAdapter } from '@forinda/kickjs-core'
import { env } from './env'

// Side-effect imports: register decorated classes
import '@/modules/messages/presentation/chat.ws-controller'
import '@/modules/queue/queue.module'

// Cron job classes
import { TaskCronJobs } from '@/modules/cron/infrastructure/jobs/overdue-reminders.cron'
import { CleanupCronJobs } from '@/modules/cron/infrastructure/jobs/token-cleanup.cron'
import { HealthCheckCronJobs } from '@/modules/cron/infrastructure/jobs/health-check.cron'
import { DigestCronJobs } from '@/modules/cron/infrastructure/jobs/daily-digest.cron'
import { PresenceCronJobs } from '@/modules/cron/infrastructure/jobs/presence-cleanup.cron'

const redisUrl = new URL(env.REDIS_URL)

const pool = new pg.Pool({ connectionString: env.DATABASE_URL })
const prismaClient = new PrismaClient({
  adapter: new PrismaPg(pool),
})

const prismaAdapter = new PrismaAdapter({
  client: prismaClient,
  logging: true,
})

const wsAdapter = WsAdapter({
  path: '/ws',
  heartbeatInterval: 30000,
  maxPayload: 1048576,
})

const queueAdapter = new QueueAdapter({
  redis: {
    host: redisUrl.hostname,
    port: Number(redisUrl.port) || 6379,
    password: redisUrl.password || undefined,
  },
  queues: ['email', 'notifications', 'activity'],
  concurrency: 5,
})

export const adapters: AppAdapter[] = [
  prismaAdapter,
  wsAdapter,
  MailerAdapter({
    provider: new ConsoleProvider(),
    defaultFrom: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_EMAIL },
  }),
  queueAdapter,
  CronAdapter({
    services: [
      TaskCronJobs,
      CleanupCronJobs,
      HealthCheckCronJobs,
      DigestCronJobs,
      PresenceCronJobs,
    ],
    enabled: true,
  }),
  new DevToolsAdapter({ adapters: [wsAdapter, queueAdapter] }),
  new SwaggerAdapter({
    info: { title: 'Vibed (Prisma Edition)', version: '1.0.0' },
  }),
]
