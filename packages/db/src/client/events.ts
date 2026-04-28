import { EventEmitter } from 'node:events'
import type { KickDbClientEvents } from './types'

type Listener<E extends keyof KickDbClientEvents> = (
  e: KickDbClientEvents[E],
) => void | Promise<void>

/**
 * Per-client typed event emitter. Wraps a Node EventEmitter to keep the
 * surface narrow (no `addListener`, no `removeAllListeners`, no `setMaxListeners`).
 *
 * The Kysely query interceptor surface is intentionally minimal in M1:
 * transactionStart/Commit/Rollback fire from createDbClient's transaction()
 * wrapper. The full beforeQuery / query / queryError emit pipeline lands in
 * M2 alongside `$extends` since it requires a proper Kysely query plugin
 * with access to the compiled SQL string + parameters. The types are stable
 * now so adopter code can wire listeners; only the runtime emit is deferred.
 */
export class KickDbEventEmitter {
  private readonly emitter = new EventEmitter()

  on<E extends keyof KickDbClientEvents>(event: E, listener: Listener<E>): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
  }

  off<E extends keyof KickDbClientEvents>(event: E, listener: Listener<E>): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void)
  }

  emit<E extends keyof KickDbClientEvents>(event: E, payload: KickDbClientEvents[E]): void {
    this.emitter.emit(event, payload)
  }
}
