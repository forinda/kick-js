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

  // Single-trip relational fetch that threads `ctx.signal` through
  // to the DB layer. If the HTTP client disconnects mid-flight (a
  // closed tab, a 30s timeout, a cancelled fetch from the browser),
  // `kickjs-db`'s M5.A.2 plumbing maps the abort to
  // `RelationalQueryCancelledError` and the in-flight query short-
  // circuits instead of churning a connection until completion.
  @Get('/:id/full')
  async showFull(ctx: RequestContext) {
    const row = await this.tasks.findFullById(ctx.params.id as string, ctx.signal)
    if (!row) {
      ctx.notFound()
      return
    }
    ctx.json(row)
  }

  @Post('/')
  async create(ctx: RequestContext) {
    const body = ctx.body as {
      projectId: string
      workspaceId: string
      key: string
      title: string
      reporterId: string
      description?: string | null
      status?: string
      priority?: 'critical' | 'high' | 'medium' | 'low' | 'none'
      estimatePoints?: number | null
      parentTaskId?: string | null
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
