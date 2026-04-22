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
import { successResponse } from '@/shared/application/api-response.dto'
import { CreateLabelUseCase } from '../application/use-cases/create-label.use-case'
import { GetLabelUseCase } from '../application/use-cases/get-label.use-case'
import { ListLabelsUseCase } from '../application/use-cases/list-labels.use-case'
import { UpdateLabelUseCase } from '../application/use-cases/update-label.use-case'
import { DeleteLabelUseCase } from '../application/use-cases/delete-label.use-case'
import { ManageTaskLabelsUseCase } from '../application/use-cases/manage-task-labels.use-case'
import { createLabelSchema } from '../application/dtos/create-label.dto'
import { updateLabelSchema } from '../application/dtos/update-label.dto'
import { LABEL_QUERY_CONFIG } from '../constants'

@Controller()
@Middleware(authBridgeMiddleware)
@ApiBearerAuth()
export class LabelController {
  @Autowired() private createLabelUseCase!: CreateLabelUseCase
  @Autowired() private getLabelUseCase!: GetLabelUseCase
  @Autowired() private listLabelsUseCase!: ListLabelsUseCase
  @Autowired() private updateLabelUseCase!: UpdateLabelUseCase
  @Autowired() private deleteLabelUseCase!: DeleteLabelUseCase
  @Autowired() private manageTaskLabelsUseCase!: ManageTaskLabelsUseCase

  @Post('/', { body: createLabelSchema, name: 'CreateLabel' })
  @ApiTags('Label')
  async create(ctx: RequestContext) {
    const result = await this.createLabelUseCase.execute(ctx.body)
    ctx.created(successResponse(result))
  }

  @Get('/')
  @ApiTags('Label')
  @ApiQueryParams(LABEL_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) =>
        this.listLabelsUseCase.execute(parsed, ctx.query.workspaceId as string | undefined),
      LABEL_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('Label')
  async getById(ctx: RequestContext) {
    const result = await this.getLabelUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Label not found')
    ctx.json(successResponse(result))
  }

  @Put('/:id', { body: updateLabelSchema, name: 'UpdateLabel' })
  @ApiTags('Label')
  async update(ctx: RequestContext) {
    const result = await this.updateLabelUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(successResponse(result))
  }

  @Delete('/:id')
  @ApiTags('Label')
  async remove(ctx: RequestContext) {
    await this.deleteLabelUseCase.execute(ctx.params.id)
    ctx.noContent()
  }

  // --- Task Labels ---

  @Get('/tasks/:taskId')
  @ApiTags('Label')
  async getTaskLabels(ctx: RequestContext) {
    const labels = await this.manageTaskLabelsUseCase.getLabels(ctx.params.taskId)
    ctx.json(successResponse(labels))
  }

  @Post('/tasks/:taskId/:labelId')
  @ApiTags('Label')
  async addToTask(ctx: RequestContext) {
    const result = await this.manageTaskLabelsUseCase.addLabel(
      ctx.params.taskId,
      ctx.params.labelId,
    )
    ctx.created(successResponse(result))
  }

  @Delete('/tasks/:taskId/:labelId')
  @ApiTags('Label')
  async removeFromTask(ctx: RequestContext) {
    await this.manageTaskLabelsUseCase.removeLabel(ctx.params.taskId, ctx.params.labelId)
    ctx.noContent()
  }
}
