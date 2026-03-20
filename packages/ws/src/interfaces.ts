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

export interface WsAdapterOptions {
  /** Base path for WebSocket upgrade (default: '/ws') */
  path?: string
  /** Heartbeat ping interval in ms (default: 30000). Set to 0 to disable. */
  heartbeatInterval?: number
  /** Maximum message payload size in bytes */
  maxPayload?: number
}

/** Registry of all @WsController classes — populated at decorator time */
export const wsControllerRegistry = new Set<Constructor>()
