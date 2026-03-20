import { Controller, Get, Post, Put, Delete, Autowired, ApiQueryParams } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { ApiTags } from '@forinda/kickjs-swagger'
import { CreateProductsUseCase } from '../application/use-cases/create-products.use-case'
import { GetProductsUseCase } from '../application/use-cases/get-products.use-case'
import { ListProductsUseCase } from '../application/use-cases/list-products.use-case'
import { UpdateProductsUseCase } from '../application/use-cases/update-products.use-case'
import { DeleteProductsUseCase } from '../application/use-cases/delete-products.use-case'
import { createProductsSchema } from '../application/dtos/create-products.dto'
import { updateProductsSchema } from '../application/dtos/update-products.dto'
import { PRODUCTS_QUERY_CONFIG } from '../constants'

@Controller()
export class ProductsController {
  @Autowired() private createProductsUseCase!: CreateProductsUseCase
  @Autowired() private getProductsUseCase!: GetProductsUseCase
  @Autowired() private listProductsUseCase!: ListProductsUseCase
  @Autowired() private updateProductsUseCase!: UpdateProductsUseCase
  @Autowired() private deleteProductsUseCase!: DeleteProductsUseCase

  @Get('/')
  @ApiTags('Products')
  @ApiQueryParams(PRODUCTS_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.listProductsUseCase.execute(parsed),
      PRODUCTS_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('Products')
  async getById(ctx: RequestContext) {
    const result = await this.getProductsUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Product not found')
    ctx.json(result)
  }

  @Post('/', { body: createProductsSchema, name: 'CreateProduct' })
  @ApiTags('Products')
  async create(ctx: RequestContext) {
    const result = await this.createProductsUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Put('/:id', { body: updateProductsSchema, name: 'UpdateProduct' })
  @ApiTags('Products')
  async update(ctx: RequestContext) {
    const result = await this.updateProductsUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  @ApiTags('Products')
  async remove(ctx: RequestContext) {
    await this.deleteProductsUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
