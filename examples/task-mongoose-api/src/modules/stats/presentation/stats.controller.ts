import { Controller, Get, Middleware, Autowired } from '@forinda/kickjs';
import type { RequestContext } from '@forinda/kickjs';
import { z } from 'zod';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@forinda/kickjs-swagger';
import { workspaceMembershipGuard } from '@/shared/guards/workspace-membership.guard';
import { projectAccessGuard } from '@/shared/guards/project-access.guard';
import { MongoTaskRepository } from '@/modules/tasks/infrastructure/repositories/mongo-task.repository';
import { getOnlineUsers } from '@/modules/messages/presentation/chat.ws-controller';
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware';

@ApiTags('Stats')
@ApiBearerAuth()
@Middleware(authBridgeMiddleware)
@Controller()
export class StatsController {
  @Autowired() private taskRepo!: MongoTaskRepository;

  @ApiOperation({ summary: 'Stream live workspace stats via SSE' })
  @ApiResponse({ status: 200, description: 'SSE stream of workspace statistics' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('/workspaces/:workspaceId/stats/live', { params: z.object({ workspaceId: z.string() }) })
  @Middleware(workspaceMembershipGuard)
  async workspaceLive(ctx: RequestContext) {
    const sse = ctx.sse();
    const workspaceId = ctx.params.workspaceId;

    const sendStats = async () => {
      const onlineUsers = getOnlineUsers();
      // Get aggregate stats across all projects in workspace
      // For now, send online user count
      sse.send({
        onlineUsersCount: onlineUsers.size,
        timestamp: new Date().toISOString(),
      }, 'stats:update');
    };

    // Send initial data
    await sendStats();

    // Periodic updates every 10 seconds
    const interval = setInterval(sendStats, 10000);

    sse.onClose(() => {
      clearInterval(interval);
    });
  }

  @ApiOperation({ summary: 'Stream live project stats via SSE' })
  @ApiResponse({ status: 200, description: 'SSE stream of project statistics' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('/projects/:projectId/stats/live', { params: z.object({ projectId: z.string() }) })
  @Middleware(projectAccessGuard)
  async projectLive(ctx: RequestContext) {
    const sse = ctx.sse();
    const projectId = ctx.params.projectId;

    const sendStats = async () => {
      const tasksByStatus = await this.taskRepo.countByStatus(projectId);
      const totalTasks = Object.values(tasksByStatus).reduce((sum, count) => sum + count, 0);
      const doneTasks = tasksByStatus['done'] ?? 0;
      const completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

      sse.send({
        tasksByStatus,
        totalTasks,
        completionRate,
        timestamp: new Date().toISOString(),
      }, 'stats:update');
    };

    await sendStats();
    const interval = setInterval(sendStats, 10000);

    sse.onClose(() => {
      clearInterval(interval);
    });
  }

  @ApiOperation({ summary: 'Stream live workspace activity via SSE' })
  @ApiResponse({ status: 200, description: 'SSE stream of workspace activity events' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('/workspaces/:workspaceId/activity/live', { params: z.object({ workspaceId: z.string() }) })
  @Middleware(workspaceMembershipGuard)
  async activityLive(ctx: RequestContext) {
    const sse = ctx.sse();

    // Send a keep-alive comment every 30 seconds
    const interval = setInterval(() => {
      sse.comment('keep-alive');
    }, 30000);

    sse.onClose(() => {
      clearInterval(interval);
    });
  }
}
