import { Controller, Get, Post, Patch, Delete, Middleware, Autowired, ApiQueryParams } from '@forinda/kickjs';
import type { RequestContext } from '@forinda/kickjs';
import { HttpException } from '@forinda/kickjs';
import { z } from 'zod';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@forinda/kickjs-swagger';
import { ErrorCode } from '@/shared/constants/error-codes';
import { createCommentSchema } from '../application/dtos/create-comment.dto';
import { updateCommentSchema } from '../application/dtos/update-comment.dto';
import { CreateCommentUseCase } from '../application/use-cases/create-comment.use-case';
import { successResponse } from '@/shared/application/api-response.dto';
import { MongoCommentRepository } from '../infrastructure/repositories/mongo-comment.repository';
import { MongoTaskRepository } from '@/modules/tasks/infrastructure/repositories/mongo-task.repository';
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware';
import { COMMENT_QUERY_CONFIG } from '@/shared/constants/query-configs';

@ApiTags('Comments')
@ApiBearerAuth()
@Middleware(authBridgeMiddleware)
@Controller()
export class CommentsController {
  @Autowired() private createCommentUseCase!: CreateCommentUseCase;
  @Autowired() private commentRepo!: MongoCommentRepository;
  @Autowired() private taskRepo!: MongoTaskRepository;

  @ApiOperation({ summary: 'Create a comment on a task' })
  @ApiResponse({ status: 201, description: 'Comment created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Post('/tasks/:taskId/comments', {
    params: z.object({ taskId: z.string() }),
    body: createCommentSchema,
  })
  async create(ctx: RequestContext) {
    const user = ctx.get('user');
    const result = await this.createCommentUseCase.execute(ctx.params.taskId, user.id, ctx.body);
    ctx.created(successResponse(result));
  }

  @ApiOperation({ summary: 'List comments for a task' })
  @ApiResponse({ status: 200, description: 'List of comments returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('/tasks/:taskId/comments', { params: z.object({ taskId: z.string() }) })
  @ApiQueryParams(COMMENT_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    await ctx.paginate(
      (parsed) => this.commentRepo.findPaginated(parsed, { taskId: ctx.params.taskId }),
      COMMENT_QUERY_CONFIG,
    );
  }

  @ApiOperation({ summary: 'Update a comment' })
  @ApiResponse({ status: 200, description: 'Comment updated successfully' })
  @ApiResponse({ status: 403, description: 'Not the comment author' })
  @ApiResponse({ status: 404, description: 'Comment not found' })
  @Patch('/comments/:commentId', {
    params: z.object({ commentId: z.string() }),
    body: updateCommentSchema,
  })
  async update(ctx: RequestContext) {
    const user = ctx.get('user');
    const comment = await this.commentRepo.findById(ctx.params.commentId);
    if (!comment) throw HttpException.notFound(ErrorCode.COMMENT_NOT_FOUND);
    if (comment.authorId.toString() !== user.id) throw HttpException.forbidden(ErrorCode.NOT_COMMENT_AUTHOR);
    const updated = await this.commentRepo.update(ctx.params.commentId, { body: ctx.body.body });
    ctx.json(successResponse(updated));
  }

  @ApiOperation({ summary: 'Delete a comment' })
  @ApiResponse({ status: 200, description: 'Comment deleted successfully' })
  @ApiResponse({ status: 403, description: 'Not the comment author' })
  @ApiResponse({ status: 404, description: 'Comment not found' })
  @Delete('/comments/:commentId', { params: z.object({ commentId: z.string() }) })
  async delete(ctx: RequestContext) {
    const user = ctx.get('user');
    const comment = await this.commentRepo.findById(ctx.params.commentId);
    if (!comment) throw HttpException.notFound(ErrorCode.COMMENT_NOT_FOUND);
    if (comment.authorId.toString() !== user.id) throw HttpException.forbidden(ErrorCode.NOT_COMMENT_AUTHOR);
    await this.commentRepo.delete(ctx.params.commentId);
    await this.taskRepo.incrementCommentCount(comment.taskId.toString(), -1);
    ctx.json(successResponse(null, 'Comment deleted'));
  }
}
