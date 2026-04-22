import { Controller, Get, Patch, Post, ApiQueryParams, Middleware, Autowired } from '@forinda/kickjs';
import type { RequestContext } from '@forinda/kickjs';
import { z } from 'zod';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@forinda/kickjs-swagger';
import { NOTIFICATION_QUERY_CONFIG } from '@/shared/constants/query-configs';

import { successResponse } from '@/shared/application/api-response.dto';
import { MongoNotificationRepository } from '../infrastructure/repositories/mongo-notification.repository';
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware';

@ApiTags('Notifications')
@ApiBearerAuth()
@Middleware(authBridgeMiddleware)
@Controller()
export class NotificationsController {
  @Autowired() private notificationRepo!: MongoNotificationRepository;

  @ApiOperation({ summary: 'List notifications for the current user' })
  @ApiResponse({ status: 200, description: 'Paginated list of notifications returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('/')
  @ApiQueryParams(NOTIFICATION_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    const user = ctx.get('user');
    await ctx.paginate(
      (parsed) => this.notificationRepo.findByRecipient(user.id, parsed),
      NOTIFICATION_QUERY_CONFIG,
    );
  }

  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Patch('/:id/read', { params: z.object({ id: z.string() }) })
  async markRead(ctx: RequestContext) {
    await this.notificationRepo.markAsRead(ctx.params.id);
    ctx.json(successResponse(null, 'Marked as read'));
  }

  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200, description: 'All notifications marked as read' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Post('/read-all')
  async markAllRead(ctx: RequestContext) {
    const user = ctx.get('user');
    await this.notificationRepo.markAllAsRead(user.id);
    ctx.json(successResponse(null, 'All marked as read'));
  }

  @ApiOperation({ summary: 'Get the unread notification count' })
  @ApiResponse({ status: 200, description: 'Unread notification count returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('/unread-count')
  async unreadCount(ctx: RequestContext) {
    const user = ctx.get('user');
    const count = await this.notificationRepo.countUnread(user.id);
    ctx.json(successResponse({ count }));
  }
}
