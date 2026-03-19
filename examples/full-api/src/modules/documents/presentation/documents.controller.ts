import {
  Controller,
  Get,
  Post,
  Delete,
  Autowired,
  Middleware,
  FileUpload,
} from '@forinda/kickjs-core'
import { RequestContext, upload } from '@forinda/kickjs-http'
import { ApiTags, ApiOperation, ApiResponse } from '@forinda/kickjs-swagger'
import { CreateDocumentsUseCase } from '../application/use-cases/create-documents.use-case'
import { GetDocumentsUseCase } from '../application/use-cases/get-documents.use-case'
import { ListDocumentsUseCase } from '../application/use-cases/list-documents.use-case'
import { DeleteDocumentsUseCase } from '../application/use-cases/delete-documents.use-case'
import { createDocumentsSchema } from '../application/dtos/create-documents.dto'

@Controller()
@ApiTags('Documents')
export class DocumentsController {
  @Autowired() private createDocumentsUseCase!: CreateDocumentsUseCase
  @Autowired() private getDocumentsUseCase!: GetDocumentsUseCase
  @Autowired() private listDocumentsUseCase!: ListDocumentsUseCase
  @Autowired() private deleteDocumentsUseCase!: DeleteDocumentsUseCase

  /**
   * List documents with query parsing.
   * Supports filters, sort, pagination, and search via ctx.qs().
   *
   * Example queries:
   *   GET /documents?filter[name][contains]=report&sort=-createdAt&page=1&limit=20
   *   GET /documents?search=quarterly
   */
  @Get('/')
  @ApiOperation({ summary: 'List documents with filtering, sorting, and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated list of documents' })
  async list(ctx: RequestContext) {
    const parsed = ctx.qs({
      filterable: ['name', 'createdAt'],
      sortable: ['name', 'createdAt', 'updatedAt'],
      searchable: ['name'],
    })

    // In a real app you would pass `parsed` to a query builder adapter:
    //   const query = drizzleAdapter.build(parsed, { columns })
    // For this example we return all documents plus the parsed query info.
    const result = await this.listDocumentsUseCase.execute()

    ctx.json({
      data: result,
      query: parsed,
    })
  }

  /**
   * Create a document with Zod body validation and optional file upload.
   * Demonstrates @FileUpload decorator + @Middleware with upload.single().
   *
   * The file is available via ctx.file after multer processes it.
   */
  @Post('/', { body: createDocumentsSchema })
  @FileUpload({ mode: 'single', fieldName: 'file', maxSize: 10 * 1024 * 1024 })
  @Middleware(upload.single('file', { maxSize: 10 * 1024 * 1024 }))
  @ApiOperation({ summary: 'Create a document with optional file attachment' })
  @ApiResponse({ status: 201, description: 'Document created' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async create(ctx: RequestContext) {
    const result = await this.createDocumentsUseCase.execute(ctx.body)

    ctx.created({
      ...result,
      file: ctx.file
        ? {
            originalName: ctx.file.originalname,
            mimeType: ctx.file.mimetype,
            size: ctx.file.size,
          }
        : null,
    })
  }

  /**
   * Get a single document by ID.
   */
  @Get('/:id')
  @ApiOperation({ summary: 'Get a document by ID' })
  @ApiResponse({ status: 200, description: 'Document found' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getById(ctx: RequestContext) {
    const result = await this.getDocumentsUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Document not found')
    ctx.json(result)
  }

  /**
   * Delete a document by ID.
   */
  @Delete('/:id')
  @ApiOperation({ summary: 'Delete a document' })
  @ApiResponse({ status: 204, description: 'Document deleted' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async remove(ctx: RequestContext) {
    await this.deleteDocumentsUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
