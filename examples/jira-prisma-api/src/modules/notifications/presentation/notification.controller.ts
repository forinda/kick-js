import { Controller, Get, Put, Autowired, Middleware, ApiQueryParams } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { ApiTags, ApiBearerAuth } from '@forinda/kickjs-swagger'
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware'
import { getUser } from '@/shared/utils/auth'
import { successResponse } from '@/shared/application/api-response.dto'
import { ListNotificationsUseCase } from '../application/use-cases/list-notifications.use-case'
import { MarkNotificationReadUseCase } from '../application/use-cases/update-notification.use-case'
import { MarkAllNotificationsReadUseCase } from '../application/use-cases/delete-notification.use-case'
import { UnreadCountUseCase } from '../application/use-cases/unread-count.use-case'
import { NOTIFICATION_QUERY_CONFIG } from '../constants'

@Controller()
@Middleware(authBridgeMiddleware)
@ApiBearerAuth()
export class NotificationController {
  @Autowired() private listNotificationsUseCase!: ListNotificationsUseCase
  @Autowired() private markReadUseCase!: MarkNotificationReadUseCase
  @Autowired() private markAllReadUseCase!: MarkAllNotificationsReadUseCase
  @Autowired() private unreadCountUseCase!: UnreadCountUseCase

  @Get('/')
  @ApiTags('Notification')
  @ApiQueryParams(NOTIFICATION_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    const user = getUser(ctx)
    return ctx.paginate(
      (parsed) => this.listNotificationsUseCase.execute(parsed, user.id),
      NOTIFICATION_QUERY_CONFIG,
    )
  }

  @Get('/unread-count')
  @ApiTags('Notification')
  async unreadCount(ctx: RequestContext) {
    const user = getUser(ctx)
    const count = await this.unreadCountUseCase.execute(user.id)
    ctx.json(successResponse({ count }))
  }

  @Put('/:id/read')
  @ApiTags('Notification')
  async markRead(ctx: RequestContext) {
    await this.markReadUseCase.execute(ctx.params.id)
    ctx.noContent()
  }

  @Put('/read-all')
  @ApiTags('Notification')
  async markAllRead(ctx: RequestContext) {
    const user = getUser(ctx)
    await this.markAllReadUseCase.execute(user.id)
    ctx.noContent()
  }
}
