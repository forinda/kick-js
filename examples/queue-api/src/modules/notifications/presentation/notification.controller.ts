import { Controller, Get, Post, Put, Delete, Autowired, ApiQueryParams } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { ApiTags } from '@forinda/kickjs-swagger'
import { CreateNotificationUseCase } from '../application/use-cases/create-notification.use-case'
import { GetNotificationUseCase } from '../application/use-cases/get-notification.use-case'
import { ListNotificationsUseCase } from '../application/use-cases/list-notifications.use-case'
import { UpdateNotificationUseCase } from '../application/use-cases/update-notification.use-case'
import { DeleteNotificationUseCase } from '../application/use-cases/delete-notification.use-case'
import { createNotificationSchema } from '../application/dtos/create-notification.dto'
import { updateNotificationSchema } from '../application/dtos/update-notification.dto'
import { NOTIFICATION_QUERY_CONFIG } from '../constants'

@Controller()
export class NotificationController {
  @Autowired() private createNotificationUseCase!: CreateNotificationUseCase
  @Autowired() private getNotificationUseCase!: GetNotificationUseCase
  @Autowired() private listNotificationsUseCase!: ListNotificationsUseCase
  @Autowired() private updateNotificationUseCase!: UpdateNotificationUseCase
  @Autowired() private deleteNotificationUseCase!: DeleteNotificationUseCase

  @Get('/')
  @ApiTags('Notification')
  @ApiQueryParams(NOTIFICATION_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.listNotificationsUseCase.execute(parsed),
      NOTIFICATION_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('Notification')
  async getById(ctx: RequestContext) {
    const result = await this.getNotificationUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Notification not found')
    ctx.json(result)
  }

  @Post('/', { body: createNotificationSchema, name: 'CreateNotification' })
  @ApiTags('Notification')
  async create(ctx: RequestContext) {
    const result = await this.createNotificationUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Put('/:id', { body: updateNotificationSchema, name: 'UpdateNotification' })
  @ApiTags('Notification')
  async update(ctx: RequestContext) {
    const result = await this.updateNotificationUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  @ApiTags('Notification')
  async remove(ctx: RequestContext) {
    await this.deleteNotificationUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
