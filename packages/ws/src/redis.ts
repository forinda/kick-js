/**
 * Redis pub/sub broker for {@link WsAdapter} — rooms, namespace broadcasts and
 * per-user sends reach sockets on every instance.
 *
 * ```ts
 * import Redis from 'ioredis'
 * import { WsAdapter } from '@forinda/kickjs-ws'
 * import { redisBroker } from '@forinda/kickjs-ws/redis'
 *
 * const redis = new Redis(process.env.REDIS_URL!)
 * WsAdapter({ broker: redisBroker({ publisher: redis, subscriber: redis.duplicate() }) })
 * ```
 *
 * @module @forinda/kickjs-ws/redis
 */
import type { WsBroker, WsBrokerMessage } from './interfaces'

/** The part of a Redis client the broker calls. An ioredis client fits as-is. */
export interface RedisPubSubClient {
  publish(channel: string, message: string): unknown
  subscribe(channel: string): unknown
  unsubscribe(channel: string): unknown
  on(event: 'message', listener: (channel: string, message: string) => void): unknown
  off?(event: 'message', listener: (channel: string, message: string) => void): unknown
}

export interface RedisBrokerOptions {
  /** Connection used for `PUBLISH`. Can be shared with the rest of the app. */
  publisher: RedisPubSubClient
  /**
   * A separate connection — a Redis connection in subscribe mode cannot run
   * other commands. With ioredis, `publisher.duplicate()`.
   */
  subscriber: RedisPubSubClient
  /** Channel shared by every instance of one app. Default `kickjs:ws`; change it to run two apps on one Redis. */
  channel?: string
}

/**
 * Both connections stay the caller's: `shutdown` unsubscribes but does not
 * quit them, since the publisher is often the app's shared client.
 */
export function redisBroker({
  publisher,
  subscriber,
  channel = 'kickjs:ws',
}: RedisBrokerOptions): WsBroker {
  let listener: ((channel: string, message: string) => void) | undefined

  return {
    async publish(message) {
      await publisher.publish(channel, JSON.stringify(message))
    },

    async subscribe(onMessage) {
      listener = (from, raw) => {
        if (from !== channel) return
        let message: WsBrokerMessage
        try {
          message = JSON.parse(raw)
        } catch {
          return // not ours — another publisher on the same channel
        }
        onMessage(message)
      }
      subscriber.on('message', listener)
      await subscriber.subscribe(channel)
    },

    async close() {
      if (listener) subscriber.off?.('message', listener)
      await subscriber.unsubscribe(channel)
    },
  }
}
