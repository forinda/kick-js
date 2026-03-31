import { Controller, Get, Post, Put, Delete, Autowired, ApiQueryParams } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { ApiTags } from '@forinda/kickjs-swagger'
import { CreateCatUseCase } from '../application/use-cases/create-cat.use-case'
import { GetCatUseCase } from '../application/use-cases/get-cat.use-case'
import { ListCatsUseCase } from '../application/use-cases/list-cats.use-case'
import { UpdateCatUseCase } from '../application/use-cases/update-cat.use-case'
import { DeleteCatUseCase } from '../application/use-cases/delete-cat.use-case'
import { createCatSchema } from '../application/dtos/create-cat.dto'
import { updateCatSchema } from '../application/dtos/update-cat.dto'
import { CAT_QUERY_CONFIG } from '../constants'

@Controller()
export class CatController {
  @Autowired() private createCatUseCase!: CreateCatUseCase
  @Autowired() private getCatUseCase!: GetCatUseCase
  @Autowired() private listCatsUseCase!: ListCatsUseCase
  @Autowired() private updateCatUseCase!: UpdateCatUseCase
  @Autowired() private deleteCatUseCase!: DeleteCatUseCase

  @Get('/')
  @ApiTags('Cat')
  @ApiQueryParams(CAT_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.listCatsUseCase.execute(parsed),
      CAT_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('Cat')
  async getById(ctx: RequestContext) {
    const result = await this.getCatUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Cat not found')
    ctx.json(result)
  }

  @Post('/', { body: createCatSchema, name: 'CreateCat' })
  @ApiTags('Cat')
  async create(ctx: RequestContext) {
    const result = await this.createCatUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Put('/:id', { body: updateCatSchema, name: 'UpdateCat' })
  @ApiTags('Cat')
  async update(ctx: RequestContext) {
    const result = await this.updateCatUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  @ApiTags('Cat')
  async remove(ctx: RequestContext) {
    await this.deleteCatUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
