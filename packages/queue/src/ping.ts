/** The part of an ioredis client a health check uses. */
interface Pingable {
  ping(): Promise<unknown>
}

/**
 * PING the Redis connection behind a BullMQ `Queue`. `queue.client` resolves
 * to its ioredis client; typed structurally because the `RedisClient` type
 * BullMQ exposes differs between majors and isn't guaranteed to carry `ping`.
 */
export async function pingQueue(queue: { client: Promise<unknown> }): Promise<void> {
  const client = (await queue.client) as Partial<Pingable>
  if (typeof client?.ping !== 'function') throw new Error('Queue client has no ping()')
  await client.ping()
}
