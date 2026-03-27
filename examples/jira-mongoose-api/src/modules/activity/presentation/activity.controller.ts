import { Controller, Get, Middleware, ApiQueryParams, Autowired } from '@forinda/kickjs-core';
import type { RequestContext } from '@forinda/kickjs-http';
import { z } from 'zod';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@forinda/kickjs-swagger';
import { ACTIVITY_QUERY_CONFIG } from '@/shared/constants/query-configs';
import { successResponse } from '@/shared/application/api-response.dto';
import { workspaceMembershipGuard } from '@/shared/guards/workspace-membership.guard';
import { projectAccessGuard } from '@/shared/guards/project-access.guard';
import { MongoActivityRepository } from '../infrastructure/repositories/mongo-activity.repository';
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware';

@ApiTags('Activity')
@ApiBearerAuth()
@Middleware(authBridgeMiddleware)
@Controller()
export class ActivityController {
  @Autowired() private activityRepo!: MongoActivityRepository;

  @ApiOperation({ summary: 'Get activity feed for a workspace' })
  @ApiResponse({ status: 200, description: 'Paginated workspace activity returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('/workspaces/:workspaceId/activity', {
    params: z.object({ workspaceId: z.string() }),
  })
  @Middleware(workspaceMembershipGuard)
  @ApiQueryParams(ACTIVITY_QUERY_CONFIG)
  async byWorkspace(ctx: RequestContext) {
    await ctx.paginate(
      (parsed) => this.activityRepo.findByWorkspace(ctx.params.workspaceId, parsed),
      ACTIVITY_QUERY_CONFIG,
    );
  }

  @ApiOperation({ summary: 'Get activity feed for a project' })
  @ApiResponse({ status: 200, description: 'Paginated project activity returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('/projects/:projectId/activity', {
    params: z.object({ projectId: z.string() }),
  })
  @Middleware(projectAccessGuard)
  @ApiQueryParams(ACTIVITY_QUERY_CONFIG)
  async byProject(ctx: RequestContext) {
    await ctx.paginate(
      (parsed) => this.activityRepo.findByProject(ctx.params.projectId, parsed),
      ACTIVITY_QUERY_CONFIG,
    );
  }

  @ApiOperation({ summary: 'Get activity feed for a task' })
  @ApiResponse({ status: 200, description: 'Task activity list returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('/tasks/:taskId/activity', { params: z.object({ taskId: z.string() }) })
  async byTask(ctx: RequestContext) {
    const activities = await this.activityRepo.findByTask(ctx.params.taskId);
    ctx.json(successResponse(activities));
  }
}
