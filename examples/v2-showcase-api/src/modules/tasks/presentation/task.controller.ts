import { Controller, Get, Post, Put, Delete, Autowired, ApiQueryParams } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { ApiTags } from '@forinda/kickjs-swagger'
import { CreateTaskUseCase } from '../application/use-cases/create-task.use-case'
import { GetTaskUseCase } from '../application/use-cases/get-task.use-case'
import { ListTasksUseCase } from '../application/use-cases/list-tasks.use-case'
import { UpdateTaskUseCase } from '../application/use-cases/update-task.use-case'
import { DeleteTaskUseCase } from '../application/use-cases/delete-task.use-case'
import { createTaskSchema } from '../application/dtos/create-task.dto'
import { updateTaskSchema } from '../application/dtos/update-task.dto'
import { TASK_QUERY_CONFIG } from '../constants'

@Controller()
export class TaskController {
  @Autowired() private createTaskUseCase!: CreateTaskUseCase
  @Autowired() private getTaskUseCase!: GetTaskUseCase
  @Autowired() private listTasksUseCase!: ListTasksUseCase
  @Autowired() private updateTaskUseCase!: UpdateTaskUseCase
  @Autowired() private deleteTaskUseCase!: DeleteTaskUseCase

  @Get('/')
  @ApiTags('Task')
  @ApiQueryParams(TASK_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.listTasksUseCase.execute(parsed),
      TASK_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('Task')
  async getById(ctx: RequestContext) {
    const result = await this.getTaskUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Task not found')
    ctx.json(result)
  }

  @Post('/', { body: createTaskSchema, name: 'CreateTask' })
  @ApiTags('Task')
  async create(ctx: RequestContext) {
    const result = await this.createTaskUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Put('/:id', { body: updateTaskSchema, name: 'UpdateTask' })
  @ApiTags('Task')
  async update(ctx: RequestContext) {
    const result = await this.updateTaskUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  @ApiTags('Task')
  async remove(ctx: RequestContext) {
    await this.deleteTaskUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
