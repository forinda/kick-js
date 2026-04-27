import { Controller, Get, Post, Patch, Autowired, type RequestContext } from '@forinda/kickjs'
import { TasksRepository } from './tasks.repository'

@Controller()
export class TasksController {
  @Autowired() private readonly tasks!: TasksRepository

  @Get('/')
  async list(ctx: RequestContext) {
    const workspaceId = ctx.query.workspaceId as string | undefined
    if (!workspaceId) {
      ctx.json({ error: 'workspaceId query param required' })
      return
    }
    const rows = await this.tasks.listByWorkspace(workspaceId)
    ctx.json({ tasks: rows })
  }

  @Post('/')
  async create(ctx: RequestContext) {
    const body = ctx.body as {
      workspaceId: string
      title: string
      description?: string | null
      status?: string
      priority?: string
      estimatePoints?: number | null
      metadata?: Record<string, unknown> | null
    }
    const created = await this.tasks.create(body)
    ctx.created(created)
  }

  @Patch('/:id/status')
  async updateStatus(ctx: RequestContext) {
    const body = ctx.body as { status: string }
    const updated = await this.tasks.updateStatus(ctx.params.id as string, body.status)
    if (!updated) {
      ctx.notFound()
      return
    }
    ctx.json(updated)
  }
}
