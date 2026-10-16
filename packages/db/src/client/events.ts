import { EventEmitter } from 'node:events'
import type { KickDbClientEvents } from './types'

type Listener<E extends keyof KickDbClientEvents> = (
  e: KickDbClientEvents[E],
) => void | Promise<void>

/**
 * Per-client typed event emitter. Wraps a Node EventEmitter to keep the
 * surface narrow (no `addListener`, no `removeAllListeners`, no `setMaxListeners`).
 *
 * `beforeQuery` fires from the dialect wrapper as each statement is sent;
 * `query` / `slowQuery` / `queryError` from Kysely's log hook; the
 * transaction events from createDbClient's transaction() wrapper.
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

/** Set on every client: whether `on()` listeners can fire (`events: true` or implied). */
export const EVENTS_ENABLED = Symbol.for('kick.db.eventsEnabled')
