import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Autowired,
  Middleware,
  ApiQueryParams,
} from '@forinda/kickjs'

import type { RequestContext } from '@forinda/kickjs'
import { ApiTags, ApiBearerAuth } from '@forinda/kickjs-swagger'
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware'
import { getUser } from '@/shared/utils/auth'
import { successResponse } from '@/shared/application/api-response.dto'
import { CreateTaskUseCase } from '../application/use-cases/create-task.use-case'
import { GetTaskUseCase } from '../application/use-cases/get-task.use-case'
import { ListTasksUseCase } from '../application/use-cases/list-tasks.use-case'
import { UpdateTaskUseCase } from '../application/use-cases/update-task.use-case'
import { DeleteTaskUseCase } from '../application/use-cases/delete-task.use-case'
import { ManageAssigneesUseCase } from '../application/use-cases/manage-assignees.use-case'
import { ListSubtasksUseCase } from '../application/use-cases/list-subtasks.use-case'
import { createTaskSchema } from '../application/dtos/create-task.dto'
import { updateTaskSchema } from '../application/dtos/update-task.dto'
import { TASK_QUERY_CONFIG } from '../constants'

@Controller()
@Middleware(authBridgeMiddleware)
@ApiBearerAuth()
export class TaskController {
  @Autowired() private createTaskUseCase!: CreateTaskUseCase
  @Autowired() private getTaskUseCase!: GetTaskUseCase
  @Autowired() private listTasksUseCase!: ListTasksUseCase
  @Autowired() private updateTaskUseCase!: UpdateTaskUseCase
  @Autowired() private deleteTaskUseCase!: DeleteTaskUseCase
  @Autowired() private manageAssigneesUseCase!: ManageAssigneesUseCase
  @Autowired() private listSubtasksUseCase!: ListSubtasksUseCase

  @Post('/', { body: createTaskSchema, name: 'CreateTask' })
  @ApiTags('Task')
  async create(ctx: RequestContext) {
    const user = getUser(ctx)
    const result = await this.createTaskUseCase.execute(ctx.body, user.id)
    ctx.created(successResponse(result))
  }

  @Get('/')
  @ApiTags('Task')
  @ApiQueryParams(TASK_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.listTasksUseCase.execute(parsed, ctx.query.projectId as string | undefined),
      TASK_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('Task')
  async getById(ctx: RequestContext) {
    const result = await this.getTaskUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Task not found')
    ctx.json(successResponse(result))
  }

  @Put('/:id', { body: updateTaskSchema, name: 'UpdateTask' })
  @ApiTags('Task')
  async update(ctx: RequestContext) {
    const result = await this.updateTaskUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(successResponse(result))
  }

  @Delete('/:id')
  @ApiTags('Task')
  async remove(ctx: RequestContext) {
    await this.deleteTaskUseCase.execute(ctx.params.id)
    ctx.noContent()
  }

  // --- Assignees ---

  @Get('/:id/assignees')
  @ApiTags('Task')
  async getAssignees(ctx: RequestContext) {
    const assignees = await this.manageAssigneesUseCase.getAssignees(ctx.params.id)
    ctx.json(successResponse(assignees))
  }

  @Post('/:id/assignees/:userId')
  @ApiTags('Task')
  async addAssignee(ctx: RequestContext) {
    const result = await this.manageAssigneesUseCase.addAssignee(ctx.params.id, ctx.params.userId)
    ctx.created(successResponse(result))
  }

  @Delete('/:id/assignees/:userId')
  @ApiTags('Task')
  async removeAssignee(ctx: RequestContext) {
    await this.manageAssigneesUseCase.removeAssignee(ctx.params.id, ctx.params.userId)
    ctx.noContent()
  }

  // --- Subtasks ---

  @Get('/:id/subtasks')
  @ApiTags('Task')
  async listSubtasks(ctx: RequestContext) {
    const subtasks = await this.listSubtasksUseCase.execute(ctx.params.id)
    ctx.json(successResponse(subtasks))
  }
}
