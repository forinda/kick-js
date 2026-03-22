import { Controller, Get, Post, Delete, Middleware, FileUpload, Autowired, ApiQueryParams } from '@forinda/kickjs-core';
import type { RequestContext } from '@forinda/kickjs-http';
import { HttpException } from '@forinda/kickjs-core';
import { z } from 'zod';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@forinda/kickjs-swagger';
import { ErrorCode } from '@/shared/constants/error-codes';
import { successResponse } from '@/shared/application/api-response.dto';
import { MongoAttachmentRepository } from '../infrastructure/repositories/mongo-attachment.repository';
import { MongoTaskRepository } from '@/modules/tasks/infrastructure/repositories/mongo-task.repository';
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware';
import { ATTACHMENT_QUERY_CONFIG } from '@/shared/constants/query-configs';

@ApiTags('Attachments')
@ApiBearerAuth()
@Middleware(authBridgeMiddleware)
@Controller()
export class AttachmentsController {
  @Autowired() private attachmentRepo!: MongoAttachmentRepository;
  @Autowired() private taskRepo!: MongoTaskRepository;

  @ApiOperation({ summary: 'Upload an attachment for a task' })
  @ApiResponse({ status: 201, description: 'Attachment uploaded and stored' })
  @ApiResponse({ status: 400, description: 'No file uploaded' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Post('/tasks/:taskId/attachments', {
    params: z.object({ taskId: z.string() }),
  })
  @FileUpload({
    mode: 'single',
    fieldName: 'file',
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/*', 'application/pdf', 'text/*', 'application/zip'],
  })
  async create(ctx: RequestContext) {
    const file = ctx.file;
    if (!file) {
      return ctx.badRequest('No file uploaded. Use field name "file".');
    }

    const user = ctx.get('user');

    const base64Data = file.buffer.toString('base64');

    const attachment = await this.attachmentRepo.create({
      taskId: ctx.params.taskId as any,
      uploadedById: user.id as any,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      base64Data,
    });

    await this.taskRepo.incrementAttachmentCount(ctx.params.taskId, 1);

    ctx.created(successResponse({
      id: attachment._id.toString(),
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
      createdAt: attachment.createdAt,
    }));
  }

  @ApiOperation({ summary: 'List attachments for a task' })
  @ApiResponse({ status: 200, description: 'List of attachments returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('/tasks/:taskId/attachments', { params: z.object({ taskId: z.string() }) })
  @ApiQueryParams(ATTACHMENT_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    await ctx.paginate(
      (parsed) => this.attachmentRepo.findPaginated(parsed, { taskId: ctx.params.taskId }),
      ATTACHMENT_QUERY_CONFIG,
    );
  }

  @ApiOperation({ summary: 'Get a single attachment by ID' })
  @ApiResponse({ status: 200, description: 'Attachment details returned' })
  @ApiResponse({ status: 404, description: 'Attachment not found' })
  @Get('/attachments/:attachmentId', { params: z.object({ attachmentId: z.string() }) })
  async getOne(ctx: RequestContext) {
    const attachment = await this.attachmentRepo.findById(ctx.params.attachmentId);
    if (!attachment) throw HttpException.notFound(ErrorCode.ATTACHMENT_NOT_FOUND);
    ctx.json(successResponse({
      id: attachment._id.toString(),
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
      base64Data: attachment.base64Data,
      createdAt: attachment.createdAt,
    }));
  }

  @ApiOperation({ summary: 'Download an attachment file' })
  @ApiResponse({ status: 200, description: 'Attachment file binary returned' })
  @ApiResponse({ status: 404, description: 'Attachment not found' })
  @Get('/attachments/:attachmentId/download', { params: z.object({ attachmentId: z.string() }) })
  async download(ctx: RequestContext) {
    const attachment = await this.attachmentRepo.findById(ctx.params.attachmentId);
    if (!attachment) throw HttpException.notFound(ErrorCode.ATTACHMENT_NOT_FOUND);

    const buffer = Buffer.from(attachment.base64Data, 'base64');
    ctx.res.setHeader('Content-Type', attachment.mimeType);
    ctx.res.setHeader('Content-Disposition', `attachment; filename="${attachment.fileName}"`);
    ctx.res.setHeader('Content-Length', buffer.length.toString());
    ctx.res.end(buffer);
  }

  @ApiOperation({ summary: 'Delete an attachment' })
  @ApiResponse({ status: 200, description: 'Attachment deleted successfully' })
  @ApiResponse({ status: 404, description: 'Attachment not found' })
  @Delete('/attachments/:attachmentId', { params: z.object({ attachmentId: z.string() }) })
  async delete(ctx: RequestContext) {
    const attachment = await this.attachmentRepo.findById(ctx.params.attachmentId);
    if (!attachment) throw HttpException.notFound(ErrorCode.ATTACHMENT_NOT_FOUND);
    await this.attachmentRepo.delete(ctx.params.attachmentId);
    await this.taskRepo.incrementAttachmentCount(attachment.taskId.toString(), -1);
    ctx.json(successResponse(null, 'Attachment deleted'));
  }
}
