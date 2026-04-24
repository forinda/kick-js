import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { PrismaAdapter } from '@forinda/kickjs-prisma'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { WsAdapter } from '@forinda/kickjs-ws'
import { QueueAdapter } from '@forinda/kickjs-queue'
import { CronAdapter } from '@/modules/cron/cron.adapter'
import { AppAdapter } from '@forinda/kickjs'
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

const prismaAdapter = PrismaAdapter({
  client: prismaClient,
  logging: true,
})

const wsAdapter = WsAdapter({
  path: '/ws',
  heartbeatInterval: 30000,
  maxPayload: 1048576,
})

const queueAdapter = QueueAdapter({
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
  DevToolsAdapter({ adapters: [wsAdapter, queueAdapter] }),
  SwaggerAdapter({
    info: { title: 'Vibed (Prisma Edition)', version: '1.0.0' },
  }),
]
