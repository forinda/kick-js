import { Controller, Get, Post, Patch, Delete, Middleware, ApiQueryParams, Autowired } from '@forinda/kickjs-core';
import type { RequestContext } from '@forinda/kickjs-http';
import { HttpException } from '@forinda/kickjs-core';
import { z } from 'zod';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@forinda/kickjs-swagger';
import { ErrorCode } from '@/shared/constants/error-codes';
import { TASK_QUERY_CONFIG } from '@/shared/constants/query-configs';
import { createTaskSchema } from '../application/dtos/create-task.dto';
import { updateTaskSchema } from '../application/dtos/update-task.dto';
import { changeStatusSchema } from '../application/dtos/change-status.dto';
import { updateAssigneesSchema } from '../application/dtos/update-assignees.dto';
import { reorderTaskSchema } from '../application/dtos/reorder-task.dto';

import { CreateTaskUseCase } from '../application/use-cases/create-task.use-case';
import { UpdateTaskUseCase } from '../application/use-cases/update-task.use-case';
import { ChangeStatusUseCase } from '../application/use-cases/change-status.use-case';
import { UpdateAssigneesUseCase } from '../application/use-cases/update-assignees.use-case';
import { ReorderTaskUseCase } from '../application/use-cases/reorder-task.use-case';
import { successResponse } from '@/shared/application/api-response.dto';
import { projectAccessGuard } from '@/shared/guards/project-access.guard';
import { MongoTaskRepository } from '../infrastructure/repositories/mongo-task.repository';
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware';

@ApiTags('Tasks')
@ApiBearerAuth()
@Middleware(authBridgeMiddleware)
@Controller()
export class TasksController {
  @Autowired() private createTaskUseCase!: CreateTaskUseCase;
  @Autowired() private updateTaskUseCase!: UpdateTaskUseCase;
  @Autowired() private changeStatusUseCase!: ChangeStatusUseCase;
  @Autowired() private updateAssigneesUseCase!: UpdateAssigneesUseCase;
  @Autowired() private reorderTaskUseCase!: ReorderTaskUseCase;
  @Autowired() private taskRepo!: MongoTaskRepository;

  @Post('/projects/:projectId/tasks', {
    params: z.object({ projectId: z.string() }),
    body: createTaskSchema,
  })
  @Middleware(projectAccessGuard)
  @ApiOperation({ summary: 'Create a new task in a project' })
  @ApiResponse({ status: 201, description: 'Task created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - no access to project' })
  async create(ctx: RequestContext) {
    const user = ctx.get('user');
    const result = await this.createTaskUseCase.execute(ctx.params.projectId, user.id, ctx.body);
    ctx.created(successResponse(result, 'Task created'));
  }

  @Get('/projects/:projectId/tasks', {
    params: z.object({ projectId: z.string() }),
  })
  @Middleware(projectAccessGuard)
  @ApiOperation({ summary: 'List tasks in a project with optional filters' })
  @ApiResponse({ status: 200, description: 'Paginated list of tasks returned successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - no access to project' })
  @ApiQueryParams(TASK_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    await ctx.paginate(
      async (parsed) => {
        parsed.filters.push({ field: 'projectId', operator: 'eq', value: ctx.params.projectId });
        return this.taskRepo.findPaginated(parsed);
      },
      TASK_QUERY_CONFIG,
    );
  }

  @Get('/tasks/:taskId', { params: z.object({ taskId: z.string() }) })
  @ApiOperation({ summary: 'Get a single task by ID' })
  @ApiResponse({ status: 200, description: 'Task returned successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async getOne(ctx: RequestContext) {
    const task = await this.taskRepo.findById(ctx.params.taskId);
    if (!task) throw HttpException.notFound(ErrorCode.TASK_NOT_FOUND);
    ctx.json(successResponse(task));
  }

  @Patch('/tasks/:taskId', { params: z.object({ taskId: z.string() }), body: updateTaskSchema })
  @ApiOperation({ summary: 'Update a task' })
  @ApiResponse({ status: 200, description: 'Task updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async update(ctx: RequestContext) {
    const result = await this.updateTaskUseCase.execute(ctx.params.taskId, ctx.body);
    ctx.json(successResponse(result));
  }

  @Delete('/tasks/:taskId', { params: z.object({ taskId: z.string() }) })
  @ApiOperation({ summary: 'Delete a task' })
  @ApiResponse({ status: 200, description: 'Task deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async delete(ctx: RequestContext) {
    const deleted = await this.taskRepo.delete(ctx.params.taskId);
    if (!deleted) throw HttpException.notFound(ErrorCode.TASK_NOT_FOUND);
    ctx.json(successResponse(null, 'Task deleted'));
  }

  @Patch('/tasks/:taskId/status', { params: z.object({ taskId: z.string() }), body: changeStatusSchema })
  @ApiOperation({ summary: 'Change the status of a task' })
  @ApiResponse({ status: 200, description: 'Task status updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async changeStatus(ctx: RequestContext) {
    const result = await this.changeStatusUseCase.execute(ctx.params.taskId, ctx.body.status);
    ctx.json(successResponse(result));
  }

  @Patch('/tasks/:taskId/assignees', { params: z.object({ taskId: z.string() }), body: updateAssigneesSchema })
  @ApiOperation({ summary: 'Update assignees for a task' })
  @ApiResponse({ status: 200, description: 'Task assignees updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async updateAssignees(ctx: RequestContext) {
    const result = await this.updateAssigneesUseCase.execute(ctx.params.taskId, ctx.body.assigneeIds);
    ctx.json(successResponse(result));
  }

  @Post('/tasks/:taskId/reorder', { params: z.object({ taskId: z.string() }), body: reorderTaskSchema })
  @ApiOperation({ summary: 'Reorder a task within its column' })
  @ApiResponse({ status: 200, description: 'Task reordered successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async reorder(ctx: RequestContext) {
    const result = await this.reorderTaskUseCase.execute(ctx.params.taskId, ctx.body);
    ctx.json(successResponse(result));
  }

  @Get('/tasks/:taskId/subtasks', { params: z.object({ taskId: z.string() }) })
  @ApiOperation({ summary: 'List subtasks of a task' })
  @ApiResponse({ status: 200, description: 'Subtasks returned successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async subtasks(ctx: RequestContext) {
    const subtasks = await this.taskRepo.findSubtasks(ctx.params.taskId);
    ctx.json(successResponse(subtasks));
  }
}
