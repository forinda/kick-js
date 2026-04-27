import { Controller, Get, Post, Autowired, type RequestContext } from '@forinda/kickjs'
import { UsersRepository } from './users.repository'

@Controller()
export class UsersController {
  @Autowired() private readonly users!: UsersRepository

  @Get('/')
  async list(ctx: RequestContext) {
    const rows = await this.users.list()
    ctx.json({ users: rows })
  }

  @Get('/:id')
  async show(ctx: RequestContext) {
    const user = await this.users.findById(ctx.params.id as string)
    if (!user) {
      ctx.notFound()
      return
    }
    ctx.json(user)
  }

  @Post('/')
  async create(ctx: RequestContext) {
    const body = ctx.body as {
      email: string
      firstName: string
      lastName: string
      avatarUrl?: string | null
    }
    const created = await this.users.create(body)
    ctx.created(created)
  }
}
