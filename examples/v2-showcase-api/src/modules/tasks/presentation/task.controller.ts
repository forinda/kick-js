import { Controller, Get, Post, Put, Delete, Autowired, type RequestContext } from '@forinda/kickjs'
import { TaskService } from '../application/task.service'
import { CreateTaskSchema, UpdateTaskSchema } from '../domain/task.entity'

@Controller()
export class TaskController {
  @Autowired() private taskService!: TaskService

  @Get('/')
  async list(ctx: RequestContext) {
    const tasks = await this.taskService.list()
    return ctx.json(tasks)
  }

  @Get('/:id')
  async get(ctx: RequestContext) {
    const task = await this.taskService.get(ctx.params.id)
    if (!task) return ctx.notFound('Task not found')
    return ctx.json(task)
  }

  @Post('/', { body: CreateTaskSchema })
  async create(ctx: RequestContext) {
    const task = await this.taskService.create(ctx.body)
    return ctx.created(task)
  }

  @Put('/:id', { body: UpdateTaskSchema })
  async update(ctx: RequestContext) {
    const task = await this.taskService.update(ctx.params.id, ctx.body)
    if (!task) return ctx.notFound('Task not found')
    return ctx.json(task)
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    const deleted = await this.taskService.remove(ctx.params.id)
    if (!deleted) return ctx.notFound('Task not found')
    return ctx.noContent()
  }
}
