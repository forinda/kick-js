import { Controller, Get, Post, Put, Delete, Autowired, ApiQueryParams } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { UsersService } from './users.service'
import { ApiTags } from '@forinda/kickjs-swagger'

@Controller('/')
export class UsersController {
  @Autowired() private usersService!: UsersService

  @Get('/')
  @ApiTags('Users')
  @ApiQueryParams({
    filterable: ['name', 'email', 'role'],
    sortable: ['name', 'email', 'createdAt'],
    searchable: ['name', 'email'],
  })
  list(ctx: RequestContext) {
    const parsed = ctx.qs({
      filterable: ['name', 'email', 'role'],
      sortable: ['name', 'email', 'createdAt'],
    })
    return ctx.json(this.usersService.findAll(parsed))
  }

  @Get('/:id')
  @ApiTags('Users')
  getById(ctx: RequestContext) {
    const user = this.usersService.findById(Number(ctx.params.id))
    if (!user) return ctx.notFound()
    return ctx.json(user)
  }

  @Post('/')
  @ApiTags('Users')
  create(ctx: RequestContext) {
    const user = this.usersService.create(ctx.body)
    return ctx.created(user)
  }

  @Post('/with-post')
  @ApiTags('Users')
  createWithPost(ctx: RequestContext) {
    const user = this.usersService.createWithPost(ctx.body)
    return ctx.created(user)
  }

  @Put('/:id')
  @ApiTags('Users')
  update(ctx: RequestContext) {
    const user = this.usersService.update(Number(ctx.params.id), ctx.body)
    if (!user) return ctx.notFound()
    return ctx.json(user)
  }

  @Delete('/:id')
  @ApiTags('Users')
  remove(ctx: RequestContext) {
    const user = this.usersService.delete(Number(ctx.params.id))
    if (!user) return ctx.notFound()
    return ctx.noContent()
  }
}
