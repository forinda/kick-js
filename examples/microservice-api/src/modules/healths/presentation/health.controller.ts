import { Controller, Get, Post, Put, Delete, Autowired, ApiQueryParams } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { ApiTags } from '@forinda/kickjs-swagger'
import { CreateHealthUseCase } from '../application/use-cases/create-health.use-case'
import { GetHealthUseCase } from '../application/use-cases/get-health.use-case'
import { ListHealthsUseCase } from '../application/use-cases/list-healths.use-case'
import { UpdateHealthUseCase } from '../application/use-cases/update-health.use-case'
import { DeleteHealthUseCase } from '../application/use-cases/delete-health.use-case'
import { createHealthSchema } from '../application/dtos/create-health.dto'
import { updateHealthSchema } from '../application/dtos/update-health.dto'
import { HEALTH_QUERY_CONFIG } from '../constants'

@Controller()
export class HealthController {
  @Autowired() private createHealthUseCase!: CreateHealthUseCase
  @Autowired() private getHealthUseCase!: GetHealthUseCase
  @Autowired() private listHealthsUseCase!: ListHealthsUseCase
  @Autowired() private updateHealthUseCase!: UpdateHealthUseCase
  @Autowired() private deleteHealthUseCase!: DeleteHealthUseCase

  @Get('/')
  @ApiTags('Health')
  @ApiQueryParams(HEALTH_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.listHealthsUseCase.execute(parsed),
      HEALTH_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('Health')
  async getById(ctx: RequestContext) {
    const result = await this.getHealthUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Health not found')
    ctx.json(result)
  }

  @Post('/', { body: createHealthSchema, name: 'CreateHealth' })
  @ApiTags('Health')
  async create(ctx: RequestContext) {
    const result = await this.createHealthUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Put('/:id', { body: updateHealthSchema, name: 'UpdateHealth' })
  @ApiTags('Health')
  async update(ctx: RequestContext) {
    const result = await this.updateHealthUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  @ApiTags('Health')
  async remove(ctx: RequestContext) {
    await this.deleteHealthUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
