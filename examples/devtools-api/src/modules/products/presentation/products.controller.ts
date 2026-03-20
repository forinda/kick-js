/**
 * Products Controller
 *
 * Presentation layer — handles HTTP requests and delegates to use cases.
 * Each method receives a RequestContext with typed body, params, and query.
 *
 * Decorators:
 *   @Controller(path?) — registers this class as an HTTP controller
 *   @Get/@Post/@Put/@Delete(path?, validation?) — defines routes with optional Zod validation
 *   @Autowired() — injects dependencies lazily from the DI container
 *   @Middleware(...handlers) — attach middleware at class or method level
 *
 * Add Swagger decorators (@ApiTags, @ApiOperation, @ApiResponse) from @forinda/kickjs-swagger
 * for automatic OpenAPI documentation.
 */
import { Controller, Get, Post, Put, Delete, Autowired } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'
import { CreateProductsUseCase } from '../application/use-cases/create-products.use-case'
import { GetProductsUseCase } from '../application/use-cases/get-products.use-case'
import { ListProductsUseCase } from '../application/use-cases/list-products.use-case'
import { UpdateProductsUseCase } from '../application/use-cases/update-products.use-case'
import { DeleteProductsUseCase } from '../application/use-cases/delete-products.use-case'
import { createProductsSchema } from '../application/dtos/create-products.dto'
import { updateProductsSchema } from '../application/dtos/update-products.dto'

@Controller()
export class ProductsController {
  @Autowired() private createProductsUseCase!: CreateProductsUseCase
  @Autowired() private getProductsUseCase!: GetProductsUseCase
  @Autowired() private listProductsUseCase!: ListProductsUseCase
  @Autowired() private updateProductsUseCase!: UpdateProductsUseCase
  @Autowired() private deleteProductsUseCase!: DeleteProductsUseCase

  @Post('/', { body: createProductsSchema })
  async create(ctx: RequestContext) {
    const result = await this.createProductsUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Get('/')
  async list(ctx: RequestContext) {
    const result = await this.listProductsUseCase.execute()
    ctx.json(result)
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const result = await this.getProductsUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Products not found')
    ctx.json(result)
  }

  @Put('/:id', { body: updateProductsSchema })
  async update(ctx: RequestContext) {
    const result = await this.updateProductsUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.deleteProductsUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
