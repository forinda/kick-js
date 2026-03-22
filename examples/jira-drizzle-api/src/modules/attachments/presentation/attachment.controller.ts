import {
  Controller,
  Get,
  Post,
  Delete,
  Autowired,
  Middleware,
  ApiQueryParams,
  FileUpload,
} from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { ApiTags, ApiBearerAuth } from '@forinda/kickjs-swagger'
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware'
import { getUser } from '@/shared/utils/auth'
import { successResponse } from '@/shared/application/api-response.dto'
import { CreateAttachmentUseCase } from '../application/use-cases/create-attachment.use-case'
import { GetAttachmentUseCase } from '../application/use-cases/get-attachment.use-case'
import { ListAttachmentsUseCase } from '../application/use-cases/list-attachments.use-case'
import { DeleteAttachmentUseCase } from '../application/use-cases/delete-attachment.use-case'
import { ATTACHMENT_QUERY_CONFIG } from '../constants'

@Controller()
@Middleware(authBridgeMiddleware)
@ApiBearerAuth()
export class AttachmentController {
  @Autowired() private createAttachmentUseCase!: CreateAttachmentUseCase
  @Autowired() private getAttachmentUseCase!: GetAttachmentUseCase
  @Autowired() private listAttachmentsUseCase!: ListAttachmentsUseCase
  @Autowired() private deleteAttachmentUseCase!: DeleteAttachmentUseCase

  @Post('/')
  @ApiTags('Attachment')
  @FileUpload({
    mode: 'single',
    fieldName: 'file',
    maxSize: 10 * 1024 * 1024, // 10MB
  })
  async create(ctx: RequestContext) {
    const user = getUser(ctx)
    const file = ctx.file
    const taskId = ctx.body.taskId

    const result = await this.createAttachmentUseCase.execute(
      {
        taskId,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        data: file.buffer.toString('base64'),
      },
      user.id,
    )
    ctx.created(successResponse(result))
  }

  @Get('/')
  @ApiTags('Attachment')
  @ApiQueryParams(ATTACHMENT_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) =>
        this.listAttachmentsUseCase.execute(parsed, ctx.query.taskId as string | undefined),
      ATTACHMENT_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('Attachment')
  async getById(ctx: RequestContext) {
    const result = await this.getAttachmentUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Attachment not found')
    ctx.json(successResponse(result))
  }

  @Get('/:id/download')
  @ApiTags('Attachment')
  async download(ctx: RequestContext) {
    const result = await this.getAttachmentUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Attachment not found')

    const buffer = Buffer.from(result.data, 'base64')
    ctx.res.setHeader('Content-Type', result.mimeType)
    ctx.res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`)
    ctx.res.setHeader('Content-Length', buffer.length)
    ctx.res.end(buffer)
  }

  @Delete('/:id')
  @ApiTags('Attachment')
  async remove(ctx: RequestContext) {
    await this.deleteAttachmentUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
