import { Controller, Get } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { ApiTags } from '@forinda/kickjs-swagger'

@Controller()
export class EventsController {
  @Get('/clock')
  @ApiTags('SSE')
  clock(ctx: RequestContext) {
    const sse = ctx.sse()

    const interval = setInterval(() => {
      sse.send({ time: new Date().toISOString() }, 'tick')
    }, 1000)

    sse.onClose(() => clearInterval(interval))
  }

  @Get('/counter')
  @ApiTags('SSE')
  counter(ctx: RequestContext) {
    const sse = ctx.sse()
    let count = 0

    const interval = setInterval(() => {
      count++
      sse.send({ count }, 'count', String(count))
    }, 500)

    sse.onClose(() => clearInterval(interval))
  }

  @Get('/notifications')
  @ApiTags('SSE')
  notifications(ctx: RequestContext) {
    const sse = ctx.sse()
    const userId = ctx.query.userId ?? 'anonymous'

    const messages = [
      'Your order has shipped',
      'New comment on your post',
      'Payment received',
      'Weekly report is ready',
      'New follower',
    ]

    let idx = 0
    const interval = setInterval(() => {
      sse.send(
        { userId, message: messages[idx % messages.length], timestamp: new Date().toISOString() },
        'notification',
      )
      idx++
    }, 3000)

    sse.onClose(() => clearInterval(interval))
  }
}
