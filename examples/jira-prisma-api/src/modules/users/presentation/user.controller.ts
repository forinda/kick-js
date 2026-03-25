import {
  Controller,
  Get,
  Put,
  Delete,
  Autowired,
  Middleware,
  ApiQueryParams,
} from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { ApiTags, ApiBearerAuth } from '@forinda/kickjs-swagger'
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware'
import { getUser } from '@/shared/utils/auth'
import { successResponse } from '@/shared/application/api-response.dto'
import { GetUserUseCase } from '../application/use-cases/get-user.use-case'
import { ListUsersUseCase } from '../application/use-cases/list-users.use-case'
import { UpdateUserUseCase } from '../application/use-cases/update-user.use-case'
import { DeleteUserUseCase } from '../application/use-cases/delete-user.use-case'
import { updateUserSchema } from '../application/dtos/update-user.dto'
import { USER_QUERY_CONFIG } from '../constants'

@Controller()
@Middleware(authBridgeMiddleware)
@ApiBearerAuth()
export class UserController {
  @Autowired() private getUserUseCase!: GetUserUseCase
  @Autowired() private listUsersUseCase!: ListUsersUseCase
  @Autowired() private updateUserUseCase!: UpdateUserUseCase
  @Autowired() private deleteUserUseCase!: DeleteUserUseCase

  @Get('/me')
  @ApiTags('User')
  async me(ctx: RequestContext) {
    const authUser = getUser(ctx)
    const user = await this.getUserUseCase.execute(authUser.id)
    ctx.json(successResponse(user))
  }

  @Put('/me', { body: updateUserSchema, name: 'UpdateProfile' })
  @ApiTags('User')
  async updateProfile(ctx: RequestContext) {
    const authUser = getUser(ctx)
    const result = await this.updateUserUseCase.execute(authUser.id, ctx.body)
    ctx.json(successResponse(result))
  }

  @Get('/')
  @ApiTags('User')
  @ApiQueryParams(USER_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate((parsed) => this.listUsersUseCase.execute(parsed), USER_QUERY_CONFIG)
  }

  @Get('/:id')
  @ApiTags('User')
  async getById(ctx: RequestContext) {
    const result = await this.getUserUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('User not found')
    ctx.json(successResponse(result))
  }

  @Delete('/:id')
  @ApiTags('User')
  async remove(ctx: RequestContext) {
    await this.deleteUserUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
