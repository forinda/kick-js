import type { IncomingMessage } from 'node:http'
import { createToken } from '@forinda/kickjs'
import type { RoomManager } from './room-manager'

type Constructor = new (...args: any[]) => any

// String metadata keys (post-Symbol migration). Slash-delimited under
// `kick/ws/` for consistency with other framework decorators and to keep
// Reflect.metadata storage collision-safe.
export const WS_METADATA = {
  WS_CONTROLLER: 'kick/ws/controller',
  WS_HANDLERS: 'kick/ws/handlers',
} as const

export type WsHandlerType = 'connect' | 'disconnect' | 'message' | 'error'

export interface WsHandlerDefinition {
  type: WsHandlerType
  /** Event name — only for 'message' type */
  event?: string
  /** Method name on the controller class */
  handlerName: string
}

/**
 * Resolved principal returned from {@link WsAuthConfig.resolveUser}. Only `id`
 * is required. The whole object is stored on the `WsContext` as `user`, and
 * `id` alone as `userId` — read them with `ctx.get('user')` / `ctx.get('userId')`.
 */
export interface WsAuthenticatedUser {
  id: string
  [key: string]: unknown
}

export interface WsAuthConfig {
  /**
   * Resolve a user from the upgrade request. Called once per socket, before
   * any `@OnConnect` handler fires. Return `null` or throw to reject.
   *
   * A rejected socket is accepted and then closed with code `4401` — a
   * WebSocket close code, not an HTTP status. Browsers do not expose a failed
   * handshake's status to script, so a close code is what a client can act on.
   *
   * Messages the client sends before this settles are held and delivered after
   * `@OnConnect`, up to 64; beyond that the socket is closed with `1008`.
   */
  resolveUser: (
    request: IncomingMessage,
  ) => Promise<WsAuthenticatedUser | null> | WsAuthenticatedUser | null
  /**
   * Join each authenticated socket to `user:<id>` as soon as `resolveUser`
   * resolves (default: `true` — pass `false` to opt out). Pairs with
   * {@link WsUserBroadcaster}.
   */
  autoJoinUserRoom?: boolean
  /**
   * Room name prefix for per-user broadcasting (default: `'user:'`).
   * Must match what `@forinda/kickjs-ws`'s `WsUserBroadcaster` targets.
   */
  userRoomPrefix?: string
}

export interface WsAdapterOptions {
  /** Base path for WebSocket upgrade (default: '/ws') */
  path?: string
  /** Heartbeat ping interval in ms (default: 30000). Set to 0 to disable. */
  heartbeatInterval?: number
  /** Maximum message payload size in bytes */
  maxPayload?: number
  /** Optional authenticated-handshake configuration. */
  auth?: WsAuthConfig
}

/**
 * Per-user broadcasting across all WS namespaces. Always registered on the DI
 * container. With {@link WsAdapterOptions.auth} sockets join `user:<id>`
 * automatically; without it a controller can join the room manually and the
 * helper works the same.
 *
 * Reaches sockets in THIS process only.
 */
export interface WsUserBroadcaster {
  /** Send a single event to every socket bound to this user. */
  toUser(userId: string): { send(event: string, data: unknown): void }
  /** Convenience — `toUser(id).send(event, data)` in one call. */
  broadcastToUser(userId: string, event: string, data: unknown): void
  /** Room name for a given user (respects `userRoomPrefix`). */
  roomFor(userId: string): string
}

/** DI token for the live {@link WsAdapter} instance. */
export const WS_ADAPTER = createToken<unknown>('kick/ws/Adapter')
/** DI token for the shared {@link RoomManager}. */
export const WS_ROOM_MANAGER = createToken<RoomManager>('kick/ws/RoomManager')
/** DI token for the per-user broadcaster helper. */
export const WS_USER_BROADCASTER = createToken<WsUserBroadcaster>('kick/ws/UserBroadcaster')

/** Registry of all @WsController classes — populated at decorator time */
export const wsControllerRegistry = new Set<Constructor>()
