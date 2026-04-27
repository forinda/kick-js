import { Controller, Get, Post, Autowired, type RequestContext } from '@forinda/kickjs'
import { WorkspacesRepository } from './workspaces.repository'

@Controller()
export class WorkspacesController {
  @Autowired() private readonly workspaces!: WorkspacesRepository

  @Get('/')
  async list(ctx: RequestContext) {
    const rows = await this.workspaces.list()
    ctx.json({ workspaces: rows })
  }

  @Get('/:id')
  async show(ctx: RequestContext) {
    const ws = await this.workspaces.findById(ctx.params.id as string)
    if (!ws) {
      ctx.notFound()
      return
    }
    ctx.json(ws)
  }

  @Post('/')
  async create(ctx: RequestContext) {
    const body = ctx.body as {
      name: string
      slug: string
      description?: string | null
      ownerId: string
    }
    const created = await this.workspaces.create(body)
    ctx.created(created)
  }
}
