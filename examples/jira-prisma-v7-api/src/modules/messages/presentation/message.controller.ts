import { Controller, Get, Post, Put, Delete, Autowired, Middleware } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { ApiTags, ApiBearerAuth } from '@forinda/kickjs-swagger'
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware'
import { getUser } from '@/shared/utils/auth'
import { successResponse } from '@/shared/application/api-response.dto'
import { CreateMessageUseCase } from '../application/use-cases/create-message.use-case'
import { ListMessagesUseCase } from '../application/use-cases/list-messages.use-case'
import { UpdateMessageUseCase } from '../application/use-cases/update-message.use-case'
import { DeleteMessageUseCase } from '../application/use-cases/delete-message.use-case'
import { createMessageSchema } from '../application/dtos/create-message.dto'
import { updateMessageSchema } from '../application/dtos/update-message.dto'

@Controller()
@Middleware(authBridgeMiddleware)
@ApiBearerAuth()
export class MessageController {
  @Autowired() private createMessageUseCase!: CreateMessageUseCase
  @Autowired() private listMessagesUseCase!: ListMessagesUseCase
  @Autowired() private updateMessageUseCase!: UpdateMessageUseCase
  @Autowired() private deleteMessageUseCase!: DeleteMessageUseCase

  @Post('/', { body: createMessageSchema, name: 'CreateMessage' })
  @ApiTags('Message')
  async create(ctx: RequestContext) {
    const user = getUser(ctx)
    const result = await this.createMessageUseCase.execute(ctx.body, user.id)
    ctx.created(successResponse(result))
  }

  @Get('/channel/:channelId')
  @ApiTags('Message')
  async listByChannel(ctx: RequestContext) {
    const messages = await this.listMessagesUseCase.execute(
      ctx.params.channelId,
      ctx.query.cursor as string | undefined,
      ctx.query.limit ? Number(ctx.query.limit) : undefined,
    )
    ctx.json(successResponse(messages))
  }

  @Put('/:id', { body: updateMessageSchema, name: 'UpdateMessage' })
  @ApiTags('Message')
  async update(ctx: RequestContext) {
    const result = await this.updateMessageUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(successResponse(result))
  }

  @Delete('/:id')
  @ApiTags('Message')
  async remove(ctx: RequestContext) {
    await this.deleteMessageUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
