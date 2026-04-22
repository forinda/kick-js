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
import { CreateCommentUseCase } from '../application/use-cases/create-comment.use-case'
import { GetCommentUseCase } from '../application/use-cases/get-comment.use-case'
import { ListCommentsUseCase } from '../application/use-cases/list-comments.use-case'
import { UpdateCommentUseCase } from '../application/use-cases/update-comment.use-case'
import { DeleteCommentUseCase } from '../application/use-cases/delete-comment.use-case'
import { createCommentSchema } from '../application/dtos/create-comment.dto'
import { updateCommentSchema } from '../application/dtos/update-comment.dto'
import { COMMENT_QUERY_CONFIG } from '../constants'

@Controller()
@Middleware(authBridgeMiddleware)
@ApiBearerAuth()
export class CommentController {
  @Autowired() private createCommentUseCase!: CreateCommentUseCase
  @Autowired() private getCommentUseCase!: GetCommentUseCase
  @Autowired() private listCommentsUseCase!: ListCommentsUseCase
  @Autowired() private updateCommentUseCase!: UpdateCommentUseCase
  @Autowired() private deleteCommentUseCase!: DeleteCommentUseCase

  @Post('/', { body: createCommentSchema, name: 'CreateComment' })
  @ApiTags('Comment')
  async create(ctx: RequestContext) {
    const user = getUser(ctx)
    const result = await this.createCommentUseCase.execute(ctx.body, user.id)
    ctx.created(successResponse(result))
  }

  @Get('/')
  @ApiTags('Comment')
  @ApiQueryParams(COMMENT_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.listCommentsUseCase.execute(parsed, ctx.query.taskId as string | undefined),
      COMMENT_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('Comment')
  async getById(ctx: RequestContext) {
    const result = await this.getCommentUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Comment not found')
    ctx.json(successResponse(result))
  }

  @Put('/:id', { body: updateCommentSchema, name: 'UpdateComment' })
  @ApiTags('Comment')
  async update(ctx: RequestContext) {
    const result = await this.updateCommentUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(successResponse(result))
  }

  @Delete('/:id')
  @ApiTags('Comment')
  async remove(ctx: RequestContext) {
    await this.deleteCommentUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
