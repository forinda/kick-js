import {
  WsController,
  OnConnect,
  OnMessage,
  type WsContext,
} from '@forinda/kickjs-ws'

/**
 * A second namespace to demonstrate multi-namespace routing.
 * Clients connect to: ws://localhost:3000/ws/notifications
 */
@WsController('/notifications')
export class NotificationController {
  @OnConnect()
  handleConnect(ctx: WsContext) {
    ctx.send('connected', { namespace: 'notifications' })
  }

  @OnMessage('subscribe')
  handleSubscribe(ctx: WsContext) {
    const topic = ctx.data.topic
    ctx.join(`notify:${topic}`)
    ctx.send('subscribed', { topic })
  }

  @OnMessage('unsubscribe')
  handleUnsubscribe(ctx: WsContext) {
    const topic = ctx.data.topic
    ctx.leave(`notify:${topic}`)
    ctx.send('unsubscribed', { topic })
  }

  @OnMessage('notify')
  handleNotify(ctx: WsContext) {
    const { topic, message } = ctx.data
    ctx.to(`notify:${topic}`).send('notification', {
      topic,
      message,
      timestamp: new Date().toISOString(),
    })
  }
}
