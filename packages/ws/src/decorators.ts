import { Service, setClassMeta, pushClassMeta } from '@forinda/kickjs'
import { WS_METADATA, wsControllerRegistry, type WsHandlerDefinition } from './interfaces'

/**
 * Mark a class as a WebSocket controller with a namespace path.
 * Registers the class in the DI container and the WS controller registry.
 *
 * @example
 * ```ts
 * @WsController('/chat')
 * export class ChatController {
 *   @OnConnect()
 *   handleConnect(ctx: WsContext) { }
 *
 *   @OnMessage('send')
 *   handleSend(ctx: WsContext) { }
 * }
 * ```
 */
export function WsController(namespace?: string): ClassDecorator {
  return (target: any) => {
    Service()(target)
    setClassMeta(WS_METADATA.WS_CONTROLLER, namespace || '/', target)
    wsControllerRegistry.add(target)
  }
}

function createWsHandlerDecorator(type: WsHandlerDefinition['type'], event?: string) {
  return (): MethodDecorator => {
    return (target, propertyKey) => {
      pushClassMeta<WsHandlerDefinition>(WS_METADATA.WS_HANDLERS, target.constructor, {
        type,
        event,
        handlerName: propertyKey as string,
      })
    }
  }
}

/**
 * Handle new WebSocket connections.
 *
 * @example
 * ```ts
 * @OnConnect()
 * handleConnect(ctx: WsContext) {
 *   console.log(`Client ${ctx.id} connected`)
 * }
 * ```
 */
export const OnConnect = createWsHandlerDecorator('connect')

/**
 * Handle WebSocket disconnections.
 *
 * @example
 * ```ts
 * @OnDisconnect()
 * handleDisconnect(ctx: WsContext) {
 *   console.log(`Client ${ctx.id} disconnected`)
 * }
 * ```
 */
export const OnDisconnect = createWsHandlerDecorator('disconnect')

/**
 * Handle WebSocket errors.
 *
 * @example
 * ```ts
 * @OnError()
 * handleError(ctx: WsContext) {
 *   console.error('WS error:', ctx.data)
 * }
 * ```
 */
export const OnError = createWsHandlerDecorator('error')

/**
 * Handle a specific WebSocket message event.
 * Use '*' as a catch-all for unmatched events.
 *
 * Messages must be JSON: `{ "event": "chat:send", "data": { ... } }`
 *
 * @example
 * ```ts
 * @OnMessage('chat:send')
 * handleChatSend(ctx: WsContext) {
 *   ctx.broadcast('chat:receive', ctx.data)
 * }
 *
 * @OnMessage('*')
 * handleUnknown(ctx: WsContext) {
 *   ctx.send('error', { message: `Unknown event: ${ctx.event}` })
 * }
 * ```
 */
export function OnMessage(event: string): MethodDecorator {
  return (target, propertyKey) => {
    pushClassMeta<WsHandlerDefinition>(WS_METADATA.WS_HANDLERS, target.constructor, {
      type: 'message',
      event,
      handlerName: propertyKey as string,
    })
  }
}
