import { getEnv } from '@forinda/kickjs'
import { QueueAdapter } from '@forinda/kickjs-queue'

/**
 * BullMQ over Redis, at REDIS_HOST / REDIS_PORT (REDIS_PASSWORD when the
 * server needs one) — declared in src/config. Nothing connects until a @Job
 * class or a queue is used, so the app boots without Redis running.
 */
export const queueAdapter = () =>
  QueueAdapter({
    redis: {
      host: getEnv('REDIS_HOST'),
      port: getEnv('REDIS_PORT'),
      password: getEnv('REDIS_PASSWORD'),
    },
  })
