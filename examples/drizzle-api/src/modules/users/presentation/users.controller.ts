import { Controller, Get, Post, Put, Delete, Autowired, ApiQueryParams } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { ApiTags } from '@forinda/kickjs-swagger'
import { CreateUsersUseCase } from '../application/use-cases/create-users.use-case'
import { GetUsersUseCase } from '../application/use-cases/get-users.use-case'
import { ListUsersUseCase } from '../application/use-cases/list-users.use-case'
import { UpdateUsersUseCase } from '../application/use-cases/update-users.use-case'
import { DeleteUsersUseCase } from '../application/use-cases/delete-users.use-case'
import { createUsersSchema } from '../application/dtos/create-users.dto'
import { updateUsersSchema } from '../application/dtos/update-users.dto'
import { USERS_QUERY_CONFIG } from '../constants'

@Controller()
export class UsersController {
  @Autowired() private createUsersUseCase!: CreateUsersUseCase
  @Autowired() private getUsersUseCase!: GetUsersUseCase
  @Autowired() private listUsersUseCase!: ListUsersUseCase
  @Autowired() private updateUsersUseCase!: UpdateUsersUseCase
  @Autowired() private deleteUsersUseCase!: DeleteUsersUseCase

  @Get('/')
  @ApiTags('Users')
  @ApiQueryParams(USERS_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.listUsersUseCase.execute(parsed),
      USERS_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('Users')
  async getById(ctx: RequestContext) {
    const result = await this.getUsersUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('User not found')
    ctx.json(result)
  }

  @Post('/', { body: createUsersSchema, name: 'CreateUser' })
  @ApiTags('Users')
  async create(ctx: RequestContext) {
    const result = await this.createUsersUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Put('/:id', { body: updateUsersSchema, name: 'UpdateUser' })
  @ApiTags('Users')
  async update(ctx: RequestContext) {
    const result = await this.updateUsersUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  @ApiTags('Users')
  async remove(ctx: RequestContext) {
    await this.deleteUsersUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
