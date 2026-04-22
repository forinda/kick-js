import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Autowired,
  Middleware,
  ApiQueryParams,
} from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { ApiTags, ApiBearerAuth } from '@forinda/kickjs-swagger'
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware'
import { getUser } from '@/shared/utils/auth'
import { successResponse } from '@/shared/application/api-response.dto'
import { CreateChannelUseCase } from '../application/use-cases/create-channel.use-case'
import { GetChannelUseCase } from '../application/use-cases/get-channel.use-case'
import { ListChannelsUseCase } from '../application/use-cases/list-channels.use-case'
import { UpdateChannelUseCase } from '../application/use-cases/update-channel.use-case'
import { DeleteChannelUseCase } from '../application/use-cases/delete-channel.use-case'
import { ManageChannelMembersUseCase } from '../application/use-cases/manage-members.use-case'
import { createChannelSchema } from '../application/dtos/create-channel.dto'
import { updateChannelSchema } from '../application/dtos/update-channel.dto'
import { CHANNEL_QUERY_CONFIG } from '../constants'

@Controller()
@Middleware(authBridgeMiddleware)
@ApiBearerAuth()
export class ChannelController {
  @Autowired() private createChannelUseCase!: CreateChannelUseCase
  @Autowired() private getChannelUseCase!: GetChannelUseCase
  @Autowired() private listChannelsUseCase!: ListChannelsUseCase
  @Autowired() private updateChannelUseCase!: UpdateChannelUseCase
  @Autowired() private deleteChannelUseCase!: DeleteChannelUseCase
  @Autowired() private manageMembersUseCase!: ManageChannelMembersUseCase

  @Post('/', { body: createChannelSchema, name: 'CreateChannel' })
  @ApiTags('Channel')
  async create(ctx: RequestContext) {
    const user = getUser(ctx)
    const result = await this.createChannelUseCase.execute(ctx.body, user.id)
    ctx.created(successResponse(result))
  }

  @Get('/')
  @ApiTags('Channel')
  @ApiQueryParams(CHANNEL_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    const workspaceId = ctx.query.workspaceId as string
    if (!workspaceId) {
      return ctx.badRequest('workspaceId query parameter is required')
    }

    return ctx.paginate(
      (parsed) => this.listChannelsUseCase.execute(parsed, workspaceId),
      CHANNEL_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('Channel')
  async getById(ctx: RequestContext) {
    const result = await this.getChannelUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Channel not found')
    ctx.json(successResponse(result))
  }

  @Put('/:id', { body: updateChannelSchema, name: 'UpdateChannel' })
  @ApiTags('Channel')
  async update(ctx: RequestContext) {
    const result = await this.updateChannelUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(successResponse(result))
  }

  @Delete('/:id')
  @ApiTags('Channel')
  async remove(ctx: RequestContext) {
    await this.deleteChannelUseCase.execute(ctx.params.id)
    ctx.noContent()
  }

  // --- Members ---

  @Get('/:id/members')
  @ApiTags('Channel')
  async listMembers(ctx: RequestContext) {
    const members = await this.manageMembersUseCase.listMembers(ctx.params.id)
    ctx.json(successResponse(members))
  }

  @Post('/:id/members/:userId')
  @ApiTags('Channel')
  async addMember(ctx: RequestContext) {
    const result = await this.manageMembersUseCase.addMember(ctx.params.id, ctx.params.userId)
    ctx.created(successResponse(result))
  }

  @Delete('/:id/members/:userId')
  @ApiTags('Channel')
  async removeMember(ctx: RequestContext) {
    await this.manageMembersUseCase.removeMember(ctx.params.id, ctx.params.userId)
    ctx.noContent()
  }
}
