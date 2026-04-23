import type { IncomingMessage } from 'node:http'
import { createToken } from '@forinda/kickjs'
import type { RoomManager } from './room-manager'

type Constructor = new (...args: any[]) => any

export const WS_METADATA = {
  WS_CONTROLLER: Symbol('kick:ws:controller'),
  WS_HANDLERS: Symbol('kick:ws:handlers'),
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
 * is required — everything else is free-form metadata stashed on the
 * `WsContext` under `user:<field>` keys for handler access.
 */
export interface WsAuthenticatedUser {
  id: string
  [key: string]: unknown
}

export interface WsAuthConfig {
  /**
   * Resolve a user from the upgrade request. Called once per socket during
   * handshake, before any `@OnConnect` handler fires. Return `null` or throw
   * to reject the socket with HTTP 401.
   */
  resolveUser: (
    request: IncomingMessage,
  ) => Promise<WsAuthenticatedUser | null> | WsAuthenticatedUser | null
  /**
   * When true, each authenticated socket auto-joins `user:<id>` immediately
   * after `resolveUser` resolves. Pairs with {@link WsUserBroadcaster}.
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
 * Per-user broadcasting across all WS namespaces. Registered on the DI
 * container when {@link WsAdapterOptions.auth} is configured, but the
 * underlying room (`user:<id>`) can also be joined manually by any
 * controller — the helper works either way.
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
