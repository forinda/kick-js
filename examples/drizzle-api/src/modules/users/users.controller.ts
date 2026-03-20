import { Controller, Get, Post, Put, Delete, Autowired } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { UsersService } from './users.service'

@Controller('/')
export class UsersController {
  @Autowired() private usersService!: UsersService

  @Get('/')
  list(ctx: RequestContext) {
    return ctx.json(this.usersService.findAll())
  }

  @Get('/:id')
  getById(ctx: RequestContext) {
    const user = this.usersService.findById(Number(ctx.params.id))
    if (!user) return ctx.notFound()
    return ctx.json(user)
  }

  @Post('/')
  create(ctx: RequestContext) {
    const user = this.usersService.create(ctx.body)
    return ctx.created(user)
  }

  @Put('/:id')
  update(ctx: RequestContext) {
    const user = this.usersService.update(Number(ctx.params.id), ctx.body)
    if (!user) return ctx.notFound()
    return ctx.json(user)
  }

  @Delete('/:id')
  remove(ctx: RequestContext) {
    const user = this.usersService.delete(Number(ctx.params.id))
    if (!user) return ctx.notFound()
    return ctx.noContent()
  }
}
