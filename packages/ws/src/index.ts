// Adapter
export { WsAdapter } from './ws-adapter'

// Context
export { WsContext } from './ws-context'

// Decorators
export { WsController, OnConnect, OnDisconnect, OnMessage, OnError } from './decorators'

// Room Manager
export { RoomManager } from './room-manager'

// Types + DI tokens
export {
  WS_ADAPTER,
  WS_METADATA,
  WS_ROOM_MANAGER,
  WS_USER_BROADCASTER,
  type WsAdapterOptions,
  type WsAuthConfig,
  type WsAuthenticatedUser,
  type WsHandlerDefinition,
  type WsHandlerType,
  type WsUserBroadcaster,
} from './interfaces'
