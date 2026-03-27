import { Controller, Get, Patch, Delete, Middleware, Autowired } from '@forinda/kickjs-core';
import type { RequestContext } from '@forinda/kickjs-http';
import { HttpException } from '@forinda/kickjs-core';
import { z } from 'zod';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@forinda/kickjs-swagger';
import { ErrorCode } from '@/shared/constants/error-codes';
import { successResponse } from '@/shared/application/api-response.dto';
import { channelMembershipGuard } from '@/shared/guards/channel-membership.guard';
import { MongoMessageRepository } from '../infrastructure/repositories/mongo-message.repository';
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware';

@ApiTags('Messages')
@ApiBearerAuth()
@Middleware(authBridgeMiddleware)
@Controller()
export class MessagesController {
  @Autowired() private messageRepo!: MongoMessageRepository;

  @ApiOperation({ summary: 'Get message history for a channel' })
  @ApiResponse({ status: 200, description: 'Paginated message history returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('/channels/:channelId/messages', {
    params: z.object({ channelId: z.string() }),
    query: z.object({
      before: z.string().optional(),
      after: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  })
  @Middleware(channelMembershipGuard)
  async history(ctx: RequestContext) {
    const messages = await this.messageRepo.findByChannel(ctx.params.channelId, ctx.query);
    ctx.json(successResponse(messages));
  }

  @ApiOperation({ summary: 'Edit a message' })
  @ApiResponse({ status: 200, description: 'Message updated successfully' })
  @ApiResponse({ status: 403, description: 'Not the message author' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  @Patch('/messages/:messageId', {
    params: z.object({ messageId: z.string() }),
    body: z.object({ content: z.string().min(1) }),
  })
  async edit(ctx: RequestContext) {
    const user = ctx.get('user');
    const message = await this.messageRepo.findById(ctx.params.messageId);
    if (!message) throw HttpException.notFound(ErrorCode.MESSAGE_NOT_FOUND);
    if (message.senderId.toString() !== user.id) throw HttpException.forbidden(ErrorCode.NOT_MESSAGE_AUTHOR);
    const updated = await this.messageRepo.update(ctx.params.messageId, { content: ctx.body.content });
    ctx.json(successResponse(updated));
  }

  @ApiOperation({ summary: 'Delete a message' })
  @ApiResponse({ status: 200, description: 'Message deleted successfully' })
  @ApiResponse({ status: 403, description: 'Not the message author' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  @Delete('/messages/:messageId', { params: z.object({ messageId: z.string() }) })
  async delete(ctx: RequestContext) {
    const user = ctx.get('user');
    const message = await this.messageRepo.findById(ctx.params.messageId);
    if (!message) throw HttpException.notFound(ErrorCode.MESSAGE_NOT_FOUND);
    if (message.senderId.toString() !== user.id) throw HttpException.forbidden(ErrorCode.NOT_MESSAGE_AUTHOR);
    await this.messageRepo.softDelete(ctx.params.messageId);
    ctx.json(successResponse(null, 'Message deleted'));
  }
}
